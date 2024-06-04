/**
* 获取某个回话的历史信息
 */
import {UserModelSchema} from "@fastgpt/global/support/user/type";
import {AppSchema} from "@fastgpt/global/core/app/type";
import {AuthUserTypeEnum} from "@fastgpt/global/support/permission/constant";
import type {NextApiRequest, NextApiResponse} from "next";
import {NextAPI} from "@/service/middleware/entry";
import requestIp from "request-ip";
import {connectToDatabase} from "@/service/mongo";
import {authCert} from "@fastgpt/service/support/permission/auth/common";
import {MongoApp} from "@fastgpt/service/core/app/schema";
import {authApp} from "@fastgpt/service/support/permission/auth/app";
import {getUserChatInfoAndAuthTeamPoints} from "@/service/support/permission/auth/team";
import {MongoChat} from "@fastgpt/service/core/chat/chatSchema";
import {ChatErrEnum} from "@fastgpt/global/common/error/code/chat";
import {getChatItems} from "@fastgpt/service/core/chat/controller";
import {addLog} from "@fastgpt/service/common/system/log";
import {jsonRes} from "@fastgpt/service/common/response";

type FastGptWebChatProps = {
    chatId?: string; // undefined: nonuse history, '': new chat, 'xxxxx': use history
    appId?: string;
};

export type Props = FastGptWebChatProps;

type AuthResponseType = {
    teamId: string;
    tmbId: string;
    user: UserModelSchema;
    app: AppSchema;
    authType: `${AuthUserTypeEnum}`;
    apikey?: string;
    canWrite: boolean;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.on('close', () => {
        res.end();
    });
    res.on('error', () => {
        console.log('error: ', 'request error');
        res.end();
    });

    const {
        chatId,
        appId,
    } = req.body as Props

    try {
        const originIp = requestIp.getClientIp(req);

        await connectToDatabase();

        /*
          1. auth app permission
          2. get app
        */
        const {teamId, tmbId, user, app, authType, apikey, canWrite} =

            await (async () => {
                /* parse req: api or token */
                return authHeaderRequest({
                    req,
                    appId,
                    chatId
                });
            })();

        const { history } = await getChatItems({
            appId: app._id,
            chatId,
            limit: 100,
            field: `dataId obj value`
        });

        addLog.info(`get chat history complete, chat id is ${chatId}`);

        res.json({
            chatId,
            history,
        })
    } catch (err) {
        jsonRes(res, {
            code: 500,
            error: err
        });
    }
}

export default NextAPI(handler);

export const config = {
    api: {
        responseLimit: '60mb'
    }
};

const authHeaderRequest = async ({
 req,
 appId,
 chatId
}: {
    req: NextApiRequest;
    appId?: string;
    chatId?: string;
}): Promise<AuthResponseType> => {
    const {
        appId: apiKeyAppId,
        teamId,
        tmbId,
        authType,
        apikey,
        canWrite: apiKeyCanWrite
    } = await authCert({
        req,
        authToken: true,
        authApiKey: true
    });

    const {app, canWrite} = await (async () => {
        if (authType === AuthUserTypeEnum.apikey) {
            if (!apiKeyAppId) {
                return Promise.reject(
                    'Key is error. You need to use the app key rather than the account key.'
                );
            }

            const app = await MongoApp.findById(apiKeyAppId);

            if (!app) {
                return Promise.reject('app is empty');
            }

            appId = String(app._id);

            return {
                app,
                canWrite: apiKeyCanWrite
            };
        } else {
            // token auth
            if (!appId) {
                return Promise.reject('appId is empty');
            }
            const {app, canWrite} = await authApp({
                req,
                authToken: true,
                appId,
                per: 'r'
            });

            return {
                app,
                canWrite: canWrite
            };
        }
    })();

    const [{user}, chat] = await Promise.all([
        getUserChatInfoAndAuthTeamPoints(tmbId),
        MongoChat.findOne({appId, chatId}).lean()
    ]);

    if (chat && (String(chat.teamId) !== teamId || String(chat.tmbId) !== tmbId)) {
        return Promise.reject(ChatErrEnum.unAuthChat);
    }

    return {
        teamId,
        tmbId,
        user,
        app,
        apikey,
        authType,
        canWrite
    };
}
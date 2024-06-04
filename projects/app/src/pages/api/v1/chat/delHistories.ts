import type {NextApiRequest, NextApiResponse} from "next";
import {NextAPI} from "@/service/middleware/entry";
import {connectToDatabase} from "@/service/mongo";
import {authCert} from "@fastgpt/service/support/permission/auth/common";
import {AuthUserTypeEnum} from "@fastgpt/global/support/permission/constant";
import {MongoApp} from "@fastgpt/service/core/app/schema";
import {authApp} from "@fastgpt/service/support/permission/auth/app";
import {getUserChatInfoAndAuthTeamPoints} from "@/service/support/permission/auth/team";
import {MongoChat} from "@fastgpt/service/core/chat/chatSchema";
import {ChatErrEnum} from "@fastgpt/global/common/error/code/chat";
import {UserModelSchema} from "@fastgpt/global/support/user/type";
import {AppSchema} from "@fastgpt/global/core/app/type";
import {autChatCrud} from "@/service/support/permission/auth/chat";
import {mongoSessionRun} from "@fastgpt/service/common/mongo/sessionRun";
import {MongoChatItem} from "@fastgpt/service/core/chat/chatItemSchema";
import {jsonRes} from "@fastgpt/service/common/response";


/**
* 删除某个回话的历史消息
 */
type FastGptDeleteHistoryProps = {
    chatId?: string;
    appId?: string;
}

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

    try {
        await connectToDatabase();

        const {appId, chatId} = req.body as FastGptDeleteHistoryProps

        const {teamId, tmbId, user, app, authType, apikey, canWrite} =

            await (async () => {
                /* parse req: api or token */
                return authHeaderRequest({
                    req,
                    appId,
                    chatId
                });
            })();

        await mongoSessionRun(async (session) => {
            await MongoChatItem.deleteMany(
                {
                    appId,
                    chatId
                },
                { session }
            );
            await MongoChat.findOneAndRemove(
                {
                    appId,
                    chatId
                },
                { session }
            );
        });

        jsonRes(res);
    } catch (err) {
        jsonRes(res, {
            code: 500,
            error: err
        });
    }
}

export default NextAPI(handler);

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

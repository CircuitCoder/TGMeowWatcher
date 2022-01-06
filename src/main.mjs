import process from 'process';

import TelegramBot from 'node-telegram-bot-api';

import CONFIG from './config.mjs';
import Store from './store.mjs';
import { tryParseCall } from './cmd.mjs';

const token = process.env.TG_BOT_TOKEN;
if(!token)
  throw new Error('Telegram bot token not set through env TG_BOT_TOKEN');

const bot = new TelegramBot(token, {
  webHook: {
    port: CONFIG.port,
    host: CONFIG.host,
    endpoint: `/${token}/`,
  },
});

bot.setWebHook(CONFIG.base);

const meThunk = bot.getMe();

const store = new Store('./store.json');

function formatAts(names) {
  if(names.length === 0) return '';
  if(names.length === 1) return names[0];

  const sliced = names.slice(0, names.length-1);
  const last = names[names.length-1];
  return sliced.join(', ') + ' and ' + last;
}

async function checkIn(uid, groups) {
  const grpResults = await Promise.all(groups.map(async e => {
    try {
      const member = await bot.getChatMember(e, uid);
      if(!member) return false;
      return ['creator', 'administrator', 'member'].includes(member.status);
    } catch(e) { /* Silently ignores */ }
    return false;
  }));

  return grpResults.some(e => e);
}

async function setRestricted(chat, user, restricted) {
  await bot.restrictChatMember(chat, user, {
    permissions: {
      can_send_messages: !restricted,
      can_send_media_messages: !restricted,
      can_send_polls: !restricted,
      can_send_other_messages: !restricted,
      can_add_web_page_previews: !restricted,
      can_change_info: !restricted,
      can_invite_users: !restricted,
      can_pin_messages: !restricted,
    },
  });
}

async function refreshChat(chat, id) {
  // Check if user is in chat
  const inGroup = await checkIn(id, [chat]);
  if(!inGroup) return null;

  const linked = store.get(chat);
  if(linked.length === 0) return null;

  const result = await checkIn(id, linked);
  await setRestricted(chat, id, !result);
  return result;
}

bot.on('new_chat_members', async msg => {
  // TODO: allow admins to add member regardless of subscription status
  const linked = store.get(msg.chat.id);
  if(linked.length === 0) return;

  const newMembers = msg.new_chat_members ?? [];
  const results = await Promise.all(newMembers.map(e => checkIn(e.id, linked)));
  const failed = newMembers.filter((_e, idx) => !results[idx]);
  if(failed.length === 0) return;

  const names = failed.map(e => {
    if(e.username) return `@${e.username}`;
    else return `<a href="tg://user?id=${e.id}">${e.first_name}</a>`
  });
  const chats = await Promise.all(linked.map(e => bot.getChat(e)));
  const chatNames= chats.map(e => {
    if(e.username) return `@${e.username}`;
    else if(e.title) return `<code>${e.title}</code>`;
    else return '`Anonmyous chat/group`';
  });

  const heading = 'Dear ' + (failed.length === 1 ? 'user' : 'users');
  const ats = formatAts(names);
  const chatHeading = chats.length === 1 ? ' ' : ' one of ';
  const chatAts = formatAts(chatNames);

  const notice = `${heading} ${ats}:\nYou've been restricted due to the the group's anti-spam policy. Please follow${chatHeading}${chatAts} and then PM the bot with command <code>/refresh</code>`;

  const sent = await bot.sendMessage(msg.chat.id, notice, {
    reply_to_message_id: msg.message_id,
    parse_mode: 'HTML',
  });

  await Promise.all(failed.map(e => {
    return setRestricted(msg.chat.id, e.id, true);
  }));
});

bot.on('text', async msg => {
  const me = await meThunk;
  const parsed = tryParseCall(msg.text, me.username);
  if(parsed === null) return;

  let ret;
  let kb = undefined;
  if(parsed.error) {
    if(parsed.error === 'UNKNOWN_CMD')
      ret = `Unknown command: <code>${parsed.cmd}</code>`;
    if(parsed.error === 'USAGE')
      ret = `Usage: <code>${parsed.usage}</code>`;
  } else {
    const { cmd, args } = parsed;

    if(cmd === 'link' || cmd === 'unlink') {
      let result;
      let chat = null;

      try {
        chat = await bot.getChat(args.target);
      } catch(e) { /* Silently ignores */ }

      // FIXME: check administration

      if(!chat) {
        ret = `Chat <code>${args.target}</code> not found! For public group/channels, use <code>@foo</code>.`;
      } else if(cmd === 'link') {
        const added = await store.add(msg.chat.id, chat.id);
        if(added)
          ret = `Done! This group is linked to <code>${chat.title ?? chat.id}</code>.`;
        else
          ret = `This group already linked to <code>${chat.title ?? chat.id}</code>.`;
      } else if(cmd === 'unlink') {
        const dropped = await store.drop(msg.chat.id, chat.id);
        if(dropped)
          ret = `Done! This group is unlinked from <code>${chat.title ?? chat.id}</code>.`;
        else
          ret = `This group not yet linked to <code>${chat.title ?? chat.id}</code>.`;
      }
    } else if(cmd === 'list') {
      const list = store.get(msg.chat.id);
      if(list.length === 0)
        ret = 'No linked chat found.';
      else {
        const chats = await Promise.all(list.map(e => bot.getChat(e)));
        const disp = chats.map(chat => {
          if(chat.username) return `@${chat.username}`;
          else if(chat.title) return `<code>${chat.title}</code>`;
          else return `<code>${chat.id}</code>`;
        });

        ret = `Linked chats: ${disp.join(', ')}`
      }
    } else if(cmd === 'refresh') {
      if(!msg.from) return; // Silently ignores
      const from = msg.from.id;
      const managed = store.list();
      const statuses = await Promise.all(managed.map(async chat => {
        const resp = await refreshChat(chat, from);
        if(resp === null) return null;
        const info = await bot.getChat(chat);
        return [info.title, resp];
      }));

      const filtered = statuses.filter(e => e !== null);
      if(filtered.length === 0) ret = `No managed chats.`;
      else {
        const disp = filtered.map(([title, rest]) => `${title}: ${rest ? 'Restricted' : 'Unrestricted'}`);
        ret = `Current restriction status:\n${disp.join('\n')}`;
      }
    }
  }

  await bot.sendMessage(msg.chat.id, ret, {
    reply_to_message_id: msg.message_id,
    parse_mode: 'HTML',
  });

  return;
});

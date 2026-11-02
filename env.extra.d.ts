// Settings and secrets, all optional: the code has a default for each (see README).
// Declared here because wrangler.jsonc carries no vars (they would overwrite the Dashboard on deploy).
interface Env {
  // Cloudflare Images (wrangler.jsonc), to shrink the photos she sends (pictures.ts). Left out, they go as they are.
  IMAGES?: ImagesBinding;
  // The old model variable: read once and moved onto the web page (see Resident.savedModel).
  MODEL?: string;
  AI_GATEWAY_ID?: string;
  // The name the web page shows for the resident (default 住户).
  RESIDENT_NAME?: string;
  // Web push to the devices that turned it on (web-push.ts): on (default: what Telegram or WeCom did not get, and
  // replies while the page is closed), always (proactive messages too when Telegram or WeCom got them) or off.
  WEB_PUSH?: string;
  TG_BOT_USERNAME?: string;
  TG_ALLOWED?: string;
  TIME_ZONE?: string;
  DEBOUNCE_SECONDS?: string;
  // Automatic letters need both this carried-chat threshold (default 30000) and the quiet time.
  LETTER_TOKEN_THRESHOLD?: string;
  LETTER_IDLE_MINUTES?: string;
  CACHE_TTL?: string;
  // How much Claude thinks (thinking.ts): auto (its own default), low, medium, high, xhigh or max.
  THINKING_EFFORT?: string;
  AELIOS_URL?: string;
  AELIOS_NAMESPACE?: string;
  // The identity in Aelios' admin page the chat goes out as (via-aelios.ts); empty for the key's first one.
  AELIOS_IDENTITY?: string;
  WEB_SEARCH?: string;
  // What lasts from a web search goes into Aelios as world knowledge (web/learn.ts); off turns it off.
  WEB_LEARN?: string;
  WEB_FETCH?: string;
  // Stickers (stickers.ts): on (default) or off, which takes send_sticker and make_sticker away.
  STICKERS?: string;
  WEB_FETCH_MODEL?: string;
  // A provider of your own (custom.ts): its address up to /v1, and openai (default) or anthropic.
  CUSTOM_BASE_URL?: string;
  CUSTOM_FORMAT?: string;
  // The Claude box for the claude-code/… models (claude-box/, docs/claude-box.md): its address, as the tunnel
  // serves it.
  CLAUDE_BOX_URL?: string;
  CHECKIN_SCHEDULE?: string;
  // When the quiet time ends but an automatic letter is not due yet, ask whether to reach out, up to this many times
  // in one quiet time: 3 by default, 0 or off never, at most 10.
  HEARTBEAT?: string;
  // The part of the night the heartbeat does not ask (quiet-hours.ts), in TIME_ZONE: 00:00-08:00 by default, off for none.
  QUIET_HOURS?: string;
  // Alarms the resident sets for itself (alarms.ts): off (default) or on.
  ALARMS?: string;
  // It changes its own persona with edit_persona (persona-edit.ts): off (default) or on.
  PERSONA_EDIT?: string;
  // Local tests only: how many seconds a minute of set_alarm's in_minutes lasts.
  ALARM_MINUTE_SECONDS?: string;
  // Local tests only: seconds of silence after which a turn is cut and run again (180 by default).
  CHAT_STALL_SECONDS?: string;
  // Voice messages (voice.ts): off (default), openrouter, elevenlabs or cartesia; the model and the voice it speaks in;
  // mirror (a voice message is answered with one, default), always, or tool (only when the resident chooses to).
  VOICE_PROVIDER?: string;
  VOICE_MODEL?: string;
  VOICE_ID?: string;
  VOICE_REPLY?: string;
  // Sends voice requests straight there instead of through AI Gateway (a proxy; the local tests).
  VOICE_BASE_URL?: string;
  // Background help (cloud-tasks.ts): on or off; a claude.ai scheduled task's API trigger, its address and token;
  // a GitHub token for GitHub Actions (hands-repo.ts).
  CLOUD_TASKS?: string;
  CLOUD_TASK_URL?: string;
  CLOUD_TASK_TOKEN?: string;
  CLOUD_TASK_GITHUB_TOKEN?: string;
  // The threads' model, here and on GitHub Actions; empty uses Workers AI's glm-4.7-flash.
  CLOUD_TASK_MODEL?: string;
  // Local tests only: where api.anthropic.com and api.github.com are reached instead, and how many minutes before a task is quiet.
  CLOUD_TASK_API_BASE?: string;
  CLOUD_TASK_QUIET_MINUTES?: string;
  // WeCom (wecom.ts): the self-built app's CorpID, AgentId and Secret, its message URL's Token and EncodingAESKey,
  // the relay on a machine with a fixed address (relay/wecom/) and its key, and the UserIDs that may talk to it.
  WECOM_CORP_ID?: string;
  WECOM_AGENT_ID?: string;
  WECOM_SECRET?: string;
  WECOM_TOKEN?: string;
  WECOM_AES_KEY?: string;
  WECOM_RELAY_URL?: string;
  WECOM_RELAY_KEY?: string;
  WECOM_ALLOWED?: string;
  // Stickers on WeCom ("on"), where they arrive as still pictures; off by default.
  WECOM_STICKERS?: string;
  // What a see-through sticker background is filled with on WeCom: a colour like #EDEDED, or "none".
  WECOM_STICKER_BACKGROUND?: string;
  // The bot token can be saved on the settings page too; the webhook secret is then made by the resident.
  TG_BOT_TOKEN?: string;
  TG_WEBHOOK_SECRET?: string;
  TG_API_BASE?: string;
  // Local tests only: the default model is the scripted one.
  FAKE_MODEL?: string;
  AELIOS_API_KEY?: string;
  TAVILY_API_KEY?: string;
  BRAVE_API_KEY?: string;
  PERPLEXITY_API_KEY?: string;
  CUSTOM_API_KEY?: string;
  // `claude setup-token`, for the `claude-code/…` models that run on her own Claude subscription (claude-code.ts).
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  // The key the Claude box checks (its BOX_KEY).
  CLAUDE_BOX_KEY?: string;
  // Empty: AI Gateway uses the key stored on the gateway for the voice provider (BYOK).
  VOICE_API_KEY?: string;
  WEB_KEY?: string;
}

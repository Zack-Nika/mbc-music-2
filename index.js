require('dotenv').config();

// --- Begin Express Server Setup ---
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send("Bot is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express server is listening on port ${PORT}`);
});
// --- End Express Server Setup ---

// --- Begin Discord Bot Code ---
const { Client, IntentsBitField } = require('discord.js');
const { Manager } = require('erela.js');
const fetch = require('isomorphic-unfetch');
const { getData } = require('spotify-url-info')(fetch);

// Create Discord client with necessary intents
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds, 
    IntentsBitField.Flags.GuildVoiceStates,
    IntentsBitField.Flags.GuildMessages, 
    IntentsBitField.Flags.MessageContent 
  ]
});

const prefix = '+';

// Set up Erela.js Lavalink Manager using environment variables
client.manager = new Manager({
  nodes: [
    {
      host: process.env.LAVALINK_HOST,       // e.g., your droplet IP address
      port: Number(process.env.LAVALINK_PORT || 2333),
      password: process.env.LAVALINK_PASSWORD,
      secure: process.env.LAVALINK_SECURE === 'true'
    }
  ],
  autoPlay: true,
  send(id, payload) {
    const guild = client.guilds.cache.get(id);
    if (guild) guild.shard.send(payload);
  }
});

// Lavalink node event handlers
client.manager.on('nodeConnect', node => {
  console.log(`✅ Connected to Lavalink node: ${node.options.host}`);
});
client.manager.on('nodeError', (node, error) => {
  console.error(`🛑 Lavalink node error: ${error.message}`);
});
client.manager.on('nodeDisconnect', node => {
  console.warn('⚠️ Lavalink node disconnected! Attempting reconnect in 5s...');
  setTimeout(() => {
    if (!node.connected) node.connect();
  }, 5000);
});

// Player event handlers
client.manager.on('trackStart', (player, track) => {
  const textChannel = client.channels.cache.get(player.textChannel);
  if (textChannel) {
    textChannel.send(`🎵 **دابا كتسمع:** ${track.title}`);
  }
});
client.manager.on('queueEnd', player => {
  const textChannel = client.channels.cache.get(player.textChannel);
  if (textChannel) {
    textChannel.send("✅ سالينا القائمة، البوت غادي يخرج من الروم دابا.");
  }
  player.destroy();
});
client.manager.on('trackError', (player, track, payload) => {
  console.error(`Track error for ${track.title}: ${payload.error}`);
  const textChannel = client.channels.cache.get(player.textChannel);
  if (textChannel) {
    textChannel.send(`⚠️ ما قدرش البوت يشغل **${track.title}** بسبب خطأ. كنزوّدو للأغنية الموالية.`);
  }
  player.stop();
});
client.manager.on('trackStuck', (player, track, payload) => {
  console.error(`Track stuck for ${track.title}: ${payload.thresholdMs}ms`);
  const textChannel = client.channels.cache.get(player.textChannel);
  if (textChannel) {
    textChannel.send(`⚠️ تعطل التشغيل ف **${track.title}** بزّاف. كنمرّو للأغنية اللي موراها...`);
  }
  player.stop();
});

// Initialize Lavalink manager when Discord client is ready
client.once('ready', () => {
  console.log(`🤖 Logged in as ${client.user.tag}!`);
  client.manager.init(client.user.id);
  client.user.setActivity("music type +play", { type: "LISTENING" });
});

// Forward raw voice events to Lavalink
client.on('raw', data => {
  client.manager.updateVoiceState(data);
});

// Command handling
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;
  
  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  
  if (command === 'ping') {
    const sent = await message.reply('🏓 جارٍ حساب وقت الاستجابة...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    sent.edit(`🏓 **Pong!** السرعة: ${latency}ms`);
  }
  else if (command === 'join') {
    if (!message.member.voice.channel) {
      return message.reply("🔊 خاصك تكون فشي روم صوتي باش تستعمل هاد الأمر!");
    }
    const voiceChannel = message.member.voice.channel;
    let player = client.manager.players.get(message.guild.id);
    if (player) {
      if (player.voiceChannel === voiceChannel.id) {
        return message.reply("🎧 البوت ديجا معاك فهاد الروم الصوتي.");
      }
      player.setVoiceChannel(voiceChannel.id);
      player.connect();
      return message.reply("🔄 البوت بدّل الروم الصوتي ديالو دابا.");
    } else {
      player = client.manager.create({
        guild: message.guild.id,
        voiceChannel: voiceChannel.id,
        textChannel: message.channel.id,
        selfDeaf: true
      });
      player.connect();
      return message.reply("✅ دخلت للروم الصوتي ديالك!");
    }
  }
  else if (command === 'play') {
    if (!message.member.voice.channel) {
      return message.reply("🔊 خاصك تكون فشي روم صوتي باش تشغل الموسيقى!");
    }
    const query = args.join(' ');
    if (!query) {
      return message.reply("ℹ️ استعمل `+play [اسم الأغنية أو رابط يوتيوب/سبوتيفاي]` من فضلك.");
    }
    
    let player = client.manager.players.get(message.guild.id);
    if (!player) {
      player = client.manager.create({
        guild: message.guild.id,
        voiceChannel: message.member.voice.channel.id,
        textChannel: message.channel.id,
        selfDeaf: true
      });
      player.connect();
    } else if (player.voiceChannel !== message.member.voice.channel.id) {
      return message.reply("⚠️ خاصك تكون نفس الروم الصوتي للي فيها البوت باش تشغل الموسيقى.");
    }
    
    try {
      // Handle Spotify URL (track or playlist)
      if (query.includes('open.spotify.com/')) {
        const spotifyData = await getData(query);
        if (spotifyData.type === 'track') {
          const trackName = spotifyData.name || spotifyData.title;
          const artistName = (spotifyData.artists && spotifyData.artists[0] && spotifyData.artists[0].name) || '';
          const searchTerm = `${trackName} ${artistName}`.trim();
          const res = await client.manager.search("ytsearch:" + searchTerm, message.author);
          if (!res.tracks.length) {
            return message.reply("❌ ما لقيتش هاد الأغنية ف يوتيوب.");
          }
          const track = res.tracks[0];
          player.queue.add(track);
          message.reply(`✔️ ضفت **${track.title}** للقائمة ديال الموسيقى!`);
        } else if (spotifyData.type === 'playlist' || spotifyData.type === 'album') {
          const tracks = spotifyData.tracks?.items || [];
          if (!tracks.length) {
            return message.reply("❌ ما لقيتش الأغاني ف هاد الـSpotify الرابط.");
          }
          for (const item of tracks) {
            const trackInfo = spotifyData.type === 'playlist' ? item.track : item;
            const name = trackInfo.name;
            const artist = (trackInfo.artists && trackInfo.artists[0] && trackInfo.artists[0].name) || '';
            if (!name) continue;
            const searchTerm = `${name} ${artist}`.trim();
            const res = await client.manager.search("ytsearch:" + searchTerm, message.author);
            if (res.tracks.length) {
              player.queue.add(res.tracks[0]);
            }
          }
          message.reply(`✔️ ضفت **${player.queue.size}** ديال الأغاني من سبوتيفاي للقائمة!`);
        } else {
          return message.reply("⚠️ ما يمكنش نشغل هاد النوع ديال روابط Spotify مباشرة.");
        }
      } else {
        // Handle YouTube search or direct URL
        const res = await client.manager.search("ytsearch:" + query, message.author);
        if (res.loadType === 'LOAD_FAILED' || !res.tracks.length) {
          return message.reply("❌ ما قدرش البوت يلقی الأغنية المطلوبة.");
        }
        if (res.loadType === 'PLAYLIST_LOADED') {
          for (const track of res.tracks) {
            player.queue.add(track);
          }
          message.reply(`✔️ ضفت **${res.tracks.length}** ديال الأغاني للقائمة ديال الموسيقى!`);
        } else {
          const track = res.tracks[0];
          player.queue.add(track);
          message.reply(`✔️ ضفت **${track.title}** للقائمة ديال الموسيقى!`);
        }
      }
      
      if (!player.playing && !player.paused && player.queue.size) {
        player.play();
      }
    } catch (err) {
      console.error(err);
      message.reply("🛑 وقع مشكل فمحاولة تشغيل هاد الموسيقى.");
    }
  }
  else if (command === 'skip') {
    const player = client.manager.players.get(message.guild.id);
    if (!player || !player.queue.current) {
      return message.reply("⚠️ ما كايناش شي أغنية مشغلة باش نخطّيوها.");
    }
    player.stop();
    message.reply("⏭️ تخطّيت للأغنية اللّي موراها.");
  }
  else if (command === 'stop') {
    const player = client.manager.players.get(message.guild.id);
    if (!player) {
      return message.reply("⚠️ ما كايناش موسيقى مشغلة باش نوقفها.");
    }
    player.destroy();
    message.reply("🛑 وقفت الموسيقى وخرجت من الروم الصوتي.");
  }
  else if (command === 'cmd' || command === 'help') {
    const helpText = "**الأوامر المتوفرة:**\n" +
      "```\n" +
      "+join - يدخل البوت للروم الصوتي ديالك\n" +
      "+play <اسم الأغنية / الرابط> - تشغيل أغنية من يوتيوب ولا سبوتيفاي\n" +
      "+skip - تخطّي الأغنية الحالية\n" +
      "+stop - توقيف الموسيقى وخروج البوت من الروم\n" +
      "+ping - عرض سرعة الاستجابة ديال البوت\n" +
      "+cmd (أو +help) - عرض هاد رسالة المساعدة\n" +
      "```";
    message.reply(helpText);
  }
});

// Log in to Discord with your token
client.login(process.env.DISCORD_TOKEN);

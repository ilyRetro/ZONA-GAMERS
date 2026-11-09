const inviteCode = '4PCc3c7YtY';
const cacheDuration = 60 * 1000;
const failureCacheDuration = 15 * 1000;

let cachedResult = null;
let cachedAt = 0;

async function getDiscordStats() {
  if (cachedResult && Date.now() - cachedAt < (cachedResult.available ? cacheDuration : failureCacheDuration)) {
    return cachedResult;
  }

  try {
    const response = await fetch(
      `https://discord.com/api/v10/invites/${inviteCode}?with_counts=true`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!response.ok) throw new Error(`Discord invite API returned HTTP ${response.status}.`);

    const invite = await response.json();
    const profile = invite.profile;
    const validCounts = profile
      && Number.isSafeInteger(profile.member_count)
      && Number.isSafeInteger(profile.online_count);
    if (invite.guild?.id !== '1340227657757098034' || !validCounts) {
      throw new Error('Discord invite API returned no valid server counts.');
    }

    const iconHash = invite.guild.icon;
    const iconFormat = typeof iconHash === 'string' && iconHash.startsWith('a_') ? 'gif' : 'webp';
    const icon = typeof iconHash === 'string' && /^(?:a_)?[a-f\d]{32}$/i.test(iconHash)
      ? `https://cdn.discordapp.com/icons/${invite.guild.id}/${iconHash}.${iconFormat}?size=64`
      : null;
    cachedResult = {
      available: true,
      members: profile.member_count,
      online: profile.online_count,
      icon
    };
  } catch (error) {
    console.error('Unable to retrieve live Discord statistics:', error.message);
    cachedResult = { available: false, members: null, online: null, icon: null };
  }
  cachedAt = Date.now();
  return cachedResult;
}

module.exports = { getDiscordStats };

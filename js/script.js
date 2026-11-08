const DISCORD_INVITE_CODE = "4PCc3c7YtY";
const DISCORD_INVITE_API =
    `https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true`;

async function loadDiscordStats() {
    const statsCard = document.getElementById("discordStats");
    const onlineCount = document.getElementById("onlineCount");
    const memberCount = document.getElementById("memberCount");

    if (!statsCard || !onlineCount || !memberCount) {
        console.error("No se pudo cargar la tarjeta de estadísticas de Discord: faltan elementos requeridos.");
        return;
    }

    try {
        const response = await fetch(DISCORD_INVITE_API);

        if (!response.ok) {
            throw new Error(`Discord respondió con HTTP ${response.status}.`);
        }

        const invite = await response.json();
        const online = invite.approximate_presence_count;
        const members = invite.approximate_member_count;

        if (!Number.isFinite(online) || !Number.isFinite(members)) {
            throw new Error("La invitación de Discord no devolvió recuentos públicos válidos.");
        }

        const numberFormat = new Intl.NumberFormat("es");
        onlineCount.textContent = numberFormat.format(online);
        memberCount.textContent = numberFormat.format(members);
        statsCard.hidden = false;
    } catch (error) {
        console.error("No se pudieron cargar las estadísticas reales de Discord.", error);
    }
}

loadDiscordStats();

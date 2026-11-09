const games = [
  {
    slug: 'american-truck',
    name: 'AMERICAN TRUCK SIMULATOR',
    categoryName: 'American Truck Simulator',
    description: 'Rutas, camiones y convoyes por las carreteras de Estados Unidos.',
    image: 'https://cdn.akamai.steamstatic.com/steam/apps/270880/header.jpg',
    faqs: [
      {
        question: '¿Cómo puedo unirme a un convoy?',
        answer: 'Publica tu horario, ruta y configuración para coordinar el viaje con otros miembros.'
      },
      {
        question: '¿Dónde comparto mis mods?',
        answer: 'Crea una publicación con el nombre del mod, su versión y cualquier requisito necesario.'
      },
      {
        question: '¿Qué hago si tengo problemas con el juego?',
        answer: 'Describe el error, tu versión del juego y los mods activos para que la comunidad pueda ayudarte.'
      }
    ]
  },
  {
    slug: 'fivem',
    name: 'FIVE M',
    categoryName: 'FiveM',
    description: 'Roleplay, servidores y experiencias creadas por la comunidad.',
    image: 'https://cdn.akamai.steamstatic.com/steam/apps/271590/header.jpg',
    faqs: [
      {
        question: '¿Cómo encuentro un servidor de roleplay?',
        answer: 'Consulta las publicaciones de la comunidad y revisa las reglas y requisitos de cada servidor.'
      },
      {
        question: '¿Qué información incluyo al pedir ayuda?',
        answer: 'Indica el mensaje de error, los pasos para reproducirlo y las versiones de FiveM y GTA V.'
      },
      {
        question: '¿Puedo compartir mi servidor?',
        answer: 'Sí. Describe su estilo de juego, reglas y cómo puede unirse la comunidad.'
      }
    ]
  },
  {
    slug: 'dayz',
    name: 'DAYZ',
    categoryName: 'DayZ',
    description: 'Supervivencia, exploración y encuentros en Chernarus.',
    image: 'https://cdn.akamai.steamstatic.com/steam/apps/221100/header.jpg',
    faqs: [
      {
        question: '¿Cómo puedo sobrevivir al inicio?',
        answer: 'Comparte tus dudas sobre suministros, salud y equipo; la comunidad puede recomendarte una estrategia.'
      },
      {
        question: '¿Dónde encuentro servidores para jugar?',
        answer: 'Revisa las publicaciones de servidores y sus detalles de ubicación, reglas y mods.'
      },
      {
        question: '¿Cómo reporto un problema técnico?',
        answer: 'Incluye la plataforma, el servidor, el mensaje de error y los pasos que causan el problema.'
      }
    ]
  },
  {
    slug: 'arma-reforger',
    name: 'ARMA REFORGER',
    categoryName: 'Arma Reforger',
    description: 'Operaciones, mods y escenarios tácticos multijugador.',
    image: 'https://cdn.akamai.steamstatic.com/steam/apps/1874880/header.jpg',
    faqs: [
      {
        question: '¿Cómo instalo mods para un servidor?',
        answer: 'Consulta los requisitos del servidor y comprueba que los mods estén actualizados y completos.'
      },
      {
        question: '¿Cómo organizo una operación?',
        answer: 'Indica el horario, el escenario, los roles disponibles y los requisitos para participar.'
      },
      {
        question: '¿Qué incluyo al reportar un error?',
        answer: 'Añade la plataforma, los pasos para reproducirlo y cualquier mensaje que aparezca en pantalla.'
      }
    ]
  }
];

const upcomingGames = [
  { name: 'PRÓXIMAMENTE', style: 'upcoming-one' },
  { name: 'PRÓXIMAMENTE', style: 'upcoming-two' }
];

module.exports = { games, upcomingGames };

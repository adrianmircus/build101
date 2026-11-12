// The fixed word list of the initial passwords of the students (docs/contratos/fase-2.md, «Contraseña de un estudiante»).
// The rules, checked by words.test.ts: at least 512 words, 3 to 5 letters, only a-z (no accents, no ñ), none repeated and none
// that could offend, scare or embarrass a teenager. Each word was read one by one in Rioplatense Spanish. To add one, read it as a
// student would, out loud, and check it against the blocklist of the test. They are plain nouns, adjectives and verbs: the subject
// of a group never appears here, because a password does not depend on it.

const WORDS: readonly string[] = (
    "abeja abrir acero adobe agrio agua aguja ahora aire ajo ala alba alce aldea alma alto amigo amor ancho ancla " +
    "andar antes apio arco arena aro aromo arpa arroz arte asa asado astro atlas atun audaz aula auto autor ave " +
    "avena aviso azul bagre baile bajar bajo balde balsa banco barco barro base bata bate beber beige bello bici " +
    "boca boina boldo bolsa bolso borde botas bote brasa bravo brazo breve brisa brote bruma buena bueno bus " +
    "cable cabo cacao caja cala caldo calle calma calmo calor cama campo canal canoa canto capa capaz cara cardo " +
    "carey carne carpa carta casa casco cavar cebra cedro ceibo cerca cerro cesta chal chico ciclo cidra cielo " +
    "cima cine cinta cinto circo cisne clara claro clase clave clavo clima clip cobre codo cofre color comer copa " +
    "copo coral coro corto corzo coser costa crear creer crema cruce cueva cuna curso curvo cuy dado danza decir " +
    "dedal dedo dejar delta denso dicho dique disco dulce duna duro eco eje emu erizo etapa falda fango faro " +
    "farol feliz feria feroz ficha fideo fiel film fino firme flan flor foco folio forma foto frase freno fruta " +
    "fruto fuego funda gaita gallo gamo ganar ganso garra garza gato gema girar globo gnomo gnu golfo goma gorra " +
    "gorro gota grado grano grapa grato grava grifo gris grupo gruta guiso habas hacer hada heno hielo hiena higo " +
    "hilo hoja hondo hongo honor hotel hueco hueso humo ibis icono idea isla jade jalea jarra jarro joven joya " +
    "juego jugar jugo junco justo kiwi koala lado lago lana lapso largo lavar lazo leal leche leer lema lemur " +
    "lente lento letra liana libro lila lima lince lindo linea lirio lisa liso listo llama llano llave lleno lobo " +
    "lodo logro loma loro luego luna lupa luz magia mago malva manga mango mano mansa manso manta manto mapa mar " +
    "marco marea masa mate matiz media medio medir menta mente mero mesa meta mica miel miga mirar mirlo mito " +
    "mono monte mora morsa mosca moto motor mover murga muro museo musgo nadar naipe nata nave nido nieve nivel " +
    "noble noche nogal noria norte nota nube nuca nuevo nuez obra ocaso ocre oeste ogro ojo okapi ola oler olivo " +
    "olla orca orden oro oruga oso ostra oveja pala palma palta pampa pan panal panda papa papel parar pared " +
    "pargo pasa pasar paso pasta pasto patio pavo paz pedal pedir peine pera perla perro pesa pesar pez piano pie " +
    "pino pinza piso pista plan plano plata plato playa plaza pleno plomo pluma poder polea polen pollo potro " +
    "pozo prado prosa pulpo puma punto puro queso radio rama rana rato raya rayo recto red regar reina reja reloj " +
    "remar remo rico rima risa ritmo roble robot roca rodar rojo ronda ropa rosa ruda rueda rumbo ruta saber " +
    "sabio saco sagaz sala salir salon salsa salto sano sapo sauce seco seda sello selva senda sepia serie siglo " +
    "signo silla sobre soda sol sopa suave subir suelo sutil tacho tala talco tallo tambo tapa tapir tarde tarta " +
    "taxi taza techo teja tejer tela tema tenaz tener tenue tero texto tibio tigre tilo tinta tiza tocar tono " +
    "topo tordo toro torre torta traje trazo tren trigo tropa tubo tuna turno unir usar uva vaca vado valle valor " +
    "vara vaso vasto vela veloz venir verde verso viaje vida viejo viga viola vivaz vivo volar voz yak yate yema " +
    "yeso yogur zinc zoo zorro zumo "
)
  .trim()
  .split(" ");

/** The words a password is made of. */
export function passwordWords(): readonly string[] {
  return WORDS;
}

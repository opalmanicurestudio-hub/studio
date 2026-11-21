// src/lib/screen-lang.ts — THE KITCHEN, DISH AND BARBACK SCREENS IN SPANISH (design canvas "The counter and the menus").
// Each screen has English and Español, picked on the screen itself and kept on that device (components/kitchen/
// ScreenLang). What the screen itself says changes: its buttons, its steps, its headings and its sheets. What the
// business wrote stays as it is: dish names, choices, stations, guests' notes and the closing checklist's items. A few
// messages the server writes (an error, a keg's pours left) stay in English for now. Pure.
export type Lang = 'en' | 'es';
export const LANGS: { id: Lang; name: string }[] = [{ id: 'en', name: 'English' }, { id: 'es', name: 'Español' }];
export const LANG_KEY = 'cf.screen.lang';
export const cleanLang = (v: unknown): Lang => (v === 'es' ? 'es' : 'en');

// The screen's own words: the English, with {name} for what's filled in, and the Spanish.
const ES: Record<string, string> = {
  // Food safety on the kitchen screen (components/kitchen/SafetySheet)
  'Food safety': 'Seguridad alimentaria', 'Readings as they’re taken. Each one carries your name.': 'Lecturas al momento de tomarlas. Cada una lleva tu nombre.',
  'The readings didn’t load.': 'Las lecturas no cargaron.', 'Tap Who’s working? and put in your PIN, so the log shows who took the reading.': 'Toca ¿Quién trabaja? y pon tu PIN, para que el registro muestre quién tomó la lectura.',
  'Saved: {what}, {t}°F.': 'Guardado: {what}, {t}°F.', 'Refused, sent back': 'Rechazado, devuelto', 'Reheated to 165°F': 'Recalentado a 165°F', 'Thrown out': 'Desechado',
  'Moved to the walk-in': 'Pasado a la cámara fría', 'Reheated first': 'Recalentado antes', 'Cooling now': 'Enfriándose ahora', 'Log a reading': 'Registrar una lectura',
  'Which reading': 'Qué lectura', 'Delivery': 'Entrega', 'Start cooling': 'Empezar a enfriar', 'Hot holding': 'Mantener caliente', 'Cold holding': 'Mantener frío', 'Cooling': 'Enfriamiento',
  'Cold 41°F or below, frozen 0°F or below, hot 135°F or above. Refuse it if it isn’t.': 'Frío a 41°F o menos, congelado a 0°F o menos, caliente a 135°F o más. Si no, recházalo.',
  'From 135°F to 70°F within 2 hours, then to 41°F within 4 more. This screen asks at each mark.': 'De 135°F a 70°F en 2 horas, luego a 41°F en 4 más. Esta pantalla pregunta en cada marca.',
  '135°F or above.': '135°F o más.', '41°F or below.': '41°F o menos.', 'What came in': 'Qué llegó', 'What’s cooling': 'Qué se está enfriando', 'What it is': 'Qué es',
  'From (the supplier)': 'De (el proveedor)', 'Cold, frozen or hot': 'Frío, congelado o caliente', 'Cold': 'Frío', 'Frozen': 'Congelado', 'Hot': 'Caliente',
  'When it came off the heat': 'Cuándo salió del fuego', 'Off the heat now': 'Salió del fuego ahora', '{n} min ago': 'hace {n} min', 'Temperature in °F': 'Temperatura en °F',
  'Outside the limit': 'Fuera del límite', 'Within the limit': 'Dentro del límite', 'What was done?': '¿Qué se hizo?', 'Save the reading': 'Guardar la lectura',
  'Nothing logged yet today.': 'Nada registrado hoy todavía.', 'Off the heat {t}': 'Salió del fuego a las {t}', 'last {n}°F': 'última {n}°F', 'Next: {mark}': 'Siguiente: {mark}',
  '{t}°F by {time}': '{t}°F antes de las {time}', '{item} reading in °F': 'Lectura de {item} en °F', 'Needs 70°F or below by the 2-hour mark.': 'Debe estar a 70°F o menos a las 2 horas.',
  'Needs {n}°F or below by the 6-hour mark.': 'Debe estar a {n}°F o menos a las 6 horas.', 'Cooling check due': 'Toca revisar el enfriamiento', '{item}: {mark}': '{item}: {mark}',
  'It didn’t reach 70°F within 2 hours. Reheat it to 165°F and cool it again, or throw it out.': 'No llegó a 70°F en 2 horas. Recaliéntalo a 165°F y enfríalo de nuevo, o deséchalo.',
  'It didn’t reach 41°F within 6 hours. Reheat it to 165°F and cool it again, or throw it out.': 'No llegó a 41°F en 6 horas. Recaliéntalo a 165°F y enfríalo de nuevo, o deséchalo.',
  'It didn’t reach 70°F within 2 hours. Reheat it to 165°F and cool it again, or throw it out. Say which.': 'No llegó a 70°F en 2 horas. Recaliéntalo a 165°F y enfríalo de nuevo, o deséchalo. Di cuál.',
  'It didn’t reach 41°F within 6 hours. Reheat it to 165°F and cool it again, or throw it out. Say which.': 'No llegó a 41°F en 6 horas. Recaliéntalo a 165°F y enfríalo de nuevo, o deséchalo. Di cuál.',
  'Say what was done': 'Di qué se hizo', 'Missed its mark. What was done?': 'Se pasó de la marca. ¿Qué se hizo?',
  // The kitchen screen
  'Kitchen': 'Cocina', 'Kitchen screen': 'Pantalla de cocina', 'Expo, every station': 'Expo, todas las estaciones',
  '{n} ticket up': '{n} comanda en pantalla', '{n} tickets up': '{n} comandas en pantalla',
  'About {n} min behind. The host stand and pickup times know.': 'Unos {n} min de retraso. La recepción y las horas de recogida ya lo saben.',
  'How tickets are shown': 'Cómo se ven las comandas', 'Lanes': 'Columnas', 'By order': 'Por pedido', 'By course': 'Por tiempo', 'By dish': 'Por plato', 'Expo': 'Expo',
  'As you, on this device': 'Con tu cuenta, en este dispositivo', 'Working:': 'Trabajando:', 'Done': 'Hecho', 'Who’s working?': '¿Quién trabaja?',
  'Every station': 'Todas las estaciones', 'Which station this screen is for': 'Para qué estación es esta pantalla',
  'Sold out': 'Agotado', 'Counts': 'Conteos', 'Call': 'Llamar', 'Tell the floor': 'Avisar al salón', 'Closing': 'Cierre',
  'Sound on': 'Sonido activado', 'Sound off': 'Sonido apagado', 'Screen': 'Pantalla', 'Language': 'Idioma',
  'Today': 'Hoy', 'Served': 'Servido', 'Waiting': 'En espera', 'Average wait': 'Espera promedio', 'none yet': 'aún nada',
  'Past their time': 'Pasadas de tiempo', 'Later': 'Más tarde', 'starts': 'empieza', 'and {n} more': 'y {n} más',
  'Held for later': 'Retenidas para después', 'Most ordered': 'Lo más pedido', 'Left tonight': 'Quedan esta noche', 'sold out': 'agotado',
  'Being made': 'En preparación', 'Ready to go out': 'Listo para salir', 'Nothing waiting.': 'Nada en espera.', 'Nothing being made.': 'Nada en preparación.',
  'Nothing ready yet.': 'Nada listo todavía.', 'No tickets up.': 'No hay comandas.', 'Loading tickets': 'Cargando comandas',
  'Tap anywhere to turn on the sound for new tickets': 'Toca en cualquier parte para activar el sonido de las comandas nuevas',
  'Show every ticket': 'Ver todas las comandas', 'Showing {name} only.': 'Solo se muestra {name}.', 'one event': 'un evento',
  'Your PIN puts your name on the tickets you move. The screen works without it.': 'Tu PIN pone tu nombre en las comandas que mueves. La pantalla funciona sin él.',
  'Cancel this ticket': 'Cancelar esta comanda', 'Cancel {item} for {name}?': '¿Cancelar {item} de {name}?', 'It comes off every screen.': 'Se quita de todas las pantallas.',
  'Anything taken off the shelf when it was ordered is put back.': 'Lo que se sacó del estante al pedirlo se devuelve.',
  'It stays on the table’s bill until it’s taken off there.': 'Sigue en la cuenta de la mesa hasta que se quite allí.',
  'The sale isn’t changed: refund it at the desk if it won’t be made.': 'La venta no cambia: si no se va a hacer, reembólsala en caja.',
  'Keep it': 'Dejarla', 'Cancel ticket': 'Cancelar comanda',
  // Allergies: said in Spanish with the English beside it, so nobody has to trust a translation with a guest's safety.
  'Milk': 'Leche (milk)', 'Dairy': 'Lácteos (dairy)', 'Eggs': 'Huevo (eggs)', 'Fish': 'Pescado (fish)', 'Shellfish': 'Mariscos (shellfish)', 'Tree nuts': 'Frutos secos (tree nuts)',
  'Peanuts': 'Cacahuate (peanuts)', 'Wheat': 'Trigo (wheat)', 'Gluten': 'Gluten', 'Soy': 'Soya (soy)', 'Sesame': 'Ajonjolí (sesame)',
  // A ticket
  'Drive-thru': 'Autoservicio', 'Counter': 'Mostrador', 'Kiosk': 'Quiosco', 'Ordered ahead': 'Pedido por adelantado', 'Lounge': 'Sala',
  'Table': 'Mesa', 'Desk': 'Caja', 'Event': 'Evento', 'Order': 'Pedido', '{a} of {b}': '{a} de {b}', 'Member perk': 'Beneficio de miembro',
  'course {n}': 'tiempo {n}', 'table {n}': 'mesa {n}', 'seat {n}': 'asiento {n}',
  'Sends when it’s back': 'Se envía al volver la conexión', 'Start {when}': 'Empezar {when}', 'Waiting {time}': 'Esperando {time}',
  'So it’s ready with the {dish}.': 'Para que salga junto con: {dish}.', 'Start now, to be ready with the {dish}.': 'Empieza ya, para que salga junto con: {dish}.',
  'Collect {amount} when it’s handed over': 'Cobrar {amount} al entregarlo', 'Look for: {what}': 'Buscar: {what}', 'How to reach them: {how}': 'Cómo llegar: {how}',
  'Started by {name}': 'Empezado por {name}', 'Allergy noted': 'Alergia anotada', 'Take from holding, {n} held': 'Tomar de lo guardado, {n} guardados',
  'Start': 'Empezar', 'Ready': 'Listo', 'Not started': 'Sin empezar', 'Print': 'Imprimir', 'Cancel': 'Cancelar',
  'Allergy': 'Alergia', 'Severe allergy:': 'Alergia grave:', 'Allergy:': 'Alergia:', '(severe)': '(grave)', 'Their note:': 'Su nota:', 'Allergy in their note:': 'Alergia en su nota:',
  'The menu lists {what} in this dish.': 'El menú indica {what} en este plato.', 'Allergy noted by {name}': 'Alergia anotada por {name}',
  '{n} item': '{n} artículo', '{n} items': '{n} artículos', '{n} ticket': '{n} comanda', '{n} tickets': '{n} comandas', 'oldest {time}': 'la más antigua {time}',
  '{n} with an allergy': '{n} con alergia', '{n} with allergies': '{n} con alergias', '{n} to note': '{n} por anotar',
  'Mark {n} ready': 'Marcar {n} listos', 'All {n} ready': 'Los {n} listos', 'Bagged and out': 'Embolsado y entregado', 'Serve the {n} ready': 'Servir los {n} listos',
  'Start {when}, with the {dish}': 'Empezar {when}, junto con: {dish}',
  'Also at {station}: {part}': 'También en {station}: {part}', 'For {dish}, from {station}': 'Para {dish}, de {station}', 'For {dish}': 'Para {dish}',
  // Expo
  'Ready to run': 'Listo para llevar', '{n} run cooking, {r} ready to go out': '{n} salida en marcha, {r} lista para salir', '{n} runs cooking, {r} ready to go out': '{n} salidas en marcha, {r} listas para salir',
  'Nothing cooking. Fired courses and orders show here.': 'Nada en marcha. Los tiempos y pedidos marchados salen aquí.',
  '{name} is coming for it': '{name} viene por ello', '{name} ran it': '{name} lo llevó', 'Runner called, {when}': 'Runner llamado, {when}', 'just now': 'justo ahora',
  '{what}, fired {when} ago': '{what}, marchado hace {when}', 'All ready': 'Todo listo', 'Allergy to note': 'Alergia por anotar', 'Waiting on {n}': 'Faltan {n}',
  'Allergy on this run. Check each plate.': 'Alergia en esta salida. Revisa cada plato.', 'remake': 'rehacer', 'noted by {name}': 'anotada por {name}', 'noted': 'anotada', 'not noted yet': 'sin anotar',
  'Making': 'Preparando', 'Calling…': 'Llamando…', 'Send a runner': 'Enviar un runner', 'We’ll run it': 'Lo llevamos', 'Run {what}': 'Llevar {what}',
  'Note the allergy first': 'Primero anota la alergia', 'Runs when all {n} are ready': 'Sale cuando los {n} estén listos', 'Held, not fired': 'Retenido, sin marchar',
  'The server fires these from the table. You see what’s coming.': 'El mesero los marcha desde la mesa. Aquí ves lo que viene.', 'Nothing held.': 'Nada retenido.', '{n} plate': '{n} plato', '{n} plates': '{n} platos',
  // Cook ahead (lib/cook-ahead).
  'Cook ahead': 'Cocinar antes', 'Cook ahead: {name}': 'Cocinar antes: {name}', '1 batch ({q}) by {time}': '1 tanda ({q}) para {time}',
  '{n} batches ({q}) by {time}': '{n} tandas ({q}) para {time}', '1 batch ({q}) now': '1 tanda ({q}) ya', '{n} batches ({q}) now': '{n} tandas ({q}) ya',
  'A usual {day} sells about {n} from {from} to {to}.': 'Un {day} normal se venden unos {n} de {from} a {to}.', '{n} held now.': '{n} guardados ahora.',
  'None held now.': 'Nada guardado ahora.', 'Start a batch of {n}': 'Empezar una tanda de {n}',
  'Start a batch of {n} {name}': 'Empezar una tanda de {n} {name}',
  'Monday': 'lunes', 'Tuesday': 'martes', 'Wednesday': 'miércoles', 'Thursday': 'jueves', 'Friday': 'viernes', 'Saturday': 'sábado', 'Sunday': 'domingo',
  // Two drive-thru lanes that merge (lib/drive-lanes).
  'Lane {n}': 'Carril {n}', 'Next at the window': 'Siguiente en la ventanilla', '1 car ahead': '1 carro antes', '{n} cars ahead': '{n} carros antes',
  'Holding': 'Guardado', '{n} thrown out today': '{n} tirados hoy', 'Nothing thrown out today': 'Nada tirado hoy', '{n} held': '{n} guardados',
  'Past its time. Throw it out.': 'Pasó su tiempo. Tíralo.', 'Use 1': 'Usar 1', 'Throw out': 'Tirar', 'Batch of {n}, {m} min': 'Tanda de {n}, {m} min',
  'Start a batch of {n} {name}, held {m} minutes': 'Empezar una tanda de {n} {name}, guardada {m} minutos',
  // Calls, on every screen
  'Your calls': 'Tus llamadas', 'Which table?': '¿Qué mesa?', 'Which one?': '¿Cuál?', 'A few words on what you need.': 'Unas palabras sobre lo que necesitas.',
  '{what}: their server’s phone buzzes.': '{what}: vibra el teléfono de su mesero.', 'You’ll see who’s on the way.': 'Verás quién va en camino.',
  'No tables with food on the go right now.': 'Ninguna mesa con comida en marcha ahora.', 'Back': 'Atrás', 'Ask': 'Pedir', 'Asking…': 'Pidiendo…', 'Close': 'Cerrar',
  'The dish pit': 'Lavaplatos', 'The barback': 'El barback', 'A runner': 'Un runner', 'The table’s server': 'El mesero de la mesa', 'A manager': 'Un gerente',
  'Plates': 'Platos', 'Bowls': 'Tazones', 'Pans to the line': 'Bandejas a la línea', 'Cutlery': 'Cubiertos', 'Glasses': 'Vasos', 'Something else': 'Otra cosa',
  'Ice': 'Hielo', 'Change a keg': 'Cambiar un barril', 'A bottle of…': 'Una botella de…', 'Limes and garnish': 'Limones y adornos',
  'Food to run': 'Comida para llevar a la mesa', 'Help at the pass': 'Ayuda en el pase', 'Come to the pass': 'Ven al pase', 'A question about the table': 'Una pregunta sobre la mesa',
  'Come to the kitchen': 'Ven a la cocina', 'A comp or a remake': 'Una cortesía o rehacer un plato',
  'Asked just now': 'Pedido justo ahora', 'Called {who}. Their phone buzzed.': 'Se llamó a {who}. Vibró su teléfono.', 'Asked {who}.': 'Se pidió a {who}.',
  'Already asked. {state}.': 'Ya se pidió. {state}.', 'No connection. Try again in a moment.': 'Sin conexión. Inténtalo de nuevo en un momento.',
  // Closing
  'The night is closed.': 'La noche está cerrada.', 'All done here.': 'Todo hecho aquí.', 'Loading…': 'Cargando…', '{n} left for {who}': 'Quedan {n} para {who}',
  'Nothing on the checklist for {who}.': 'Nada en la lista para {who}.', 'the kitchen and bar': 'la cocina y la barra', 'the kitchen or bar': 'la cocina o la barra',
  'the dish pit': 'el lavaplatos', 'the bar': 'la barra', 'Bar': 'Barra', 'Dish': 'Lavaplatos', 'Anyone': 'Cualquiera', 'Reading': 'Lectura', 'Save': 'Guardar',
  'Outside the limit. What was done?': 'Fuera del límite. ¿Qué se hizo?', 'The checklist didn’t load.': 'La lista no cargó.', 'That didn’t save.': 'No se guardó.',
  // The dish and barback screens
  'Barback': 'Barback', 'Asked for': 'Lo que piden', 'You asked': 'Lo que pediste', '{name} is working.': '{name} está trabajando.', 'The rush: {when}.': 'La hora pico: {when}.',
  'Not {name}?': '¿No eres {name}?', 'Call dish': 'Llamar a lavaplatos', 'Broke something': 'Se rompió algo', 'Undo': 'Deshacer', 'Saving…': 'Guardando…',
  'Tap anywhere to turn the sound on.': 'Toca en cualquier parte para activar el sonido.', 'No connection since {time}. It keeps trying.': 'Sin conexión desde las {time}. Sigue intentando.',
  'On my way': 'Voy en camino', 'Not me after all': 'Al final no voy', 'You’re on it': 'Vas tú', '{name} on the way': '{name} en camino', 'Just now': 'Justo ahora', '{n} min': '{n} min',
  'Nothing asked for. What the line and the bar call for shows here, with a chime.': 'Nada pedido. Lo que piden la línea y la barra sale aquí, con un sonido.',
  'Nothing asked for. What the bar calls for shows here, with a chime.': 'Nada pedido. Lo que pide la barra sale aquí, con un sonido.',
  '{name} is already on the way.': '{name} ya va en camino.', 'Someone': 'Alguien', 'That didn’t go through.': 'No se pudo hacer.',
  'Heading your way': 'Lo que viene', 'Plates and glasses that went out, every 15 minutes. They come back within the hour.': 'Platos y vasos que salieron, cada 15 minutos. Vuelven dentro de la hora.',
  'Being cleared now': 'Mesas que se recogen ahora', '{n} guest': '{n} persona', '{n} guests': '{n} personas', 'just left': 'acaban de irse', 'left {n} min ago': 'se fueron hace {n} min',
  'Machine check due': 'Toca revisar la máquina', 'Machine check': 'Revisión de la máquina', 'Good': 'Bien', 'The log, to print': 'El registro, para imprimir',
  'Broken today: {what}.': 'Roto hoy: {what}.', 'It happens. Logged so the business can reorder.': 'Pasa. Se anota para volver a pedir.', 'What broke': 'Qué se rompió',
  'Plate': 'Plato', 'Bowl': 'Tazón', 'Glass': 'Vaso', 'Wine glass': 'Copa de vino', 'Mug or cup': 'Taza', 'What was it?': '¿Qué era?', 'How many': 'Cuántos',
  'One fewer': 'Uno menos', 'One more': 'Uno más', 'Log it': 'Anotarlo',
  '{n} glasses': '{n} vasos', 'Every 15 minutes: {what}': 'Cada 15 minutos: {what}',
  'and {n} glass went out in the last 30 minutes': 'y {n} vaso salieron en los últimos 30 minutos', 'and {n} glasses went out in the last 30 minutes': 'y {n} vasos salieron en los últimos 30 minutos',
  'Final rinse': 'Enjuague final', 'Sanitizer': 'Desinfectante', 'Time for the next one.': 'Toca la siguiente.', 'Check it again once it’s put right.': 'Revísala de nuevo cuando esté arreglada.',
  'Next by {time}.': 'La siguiente antes de las {time}.', 'Done for today.': 'Listo por hoy.', 'Ran it again, called for service, washing by hand': 'La pasé otra vez, llamé al técnico, lavando a mano',
  'Your PIN puts your name on what you do.': 'Tu PIN pone tu nombre en lo que haces.', 'Delete': 'Borrar', '{n} of 4 digits entered': '{n} de 4 dígitos', '{n} of 4 digits': '{n} de 4 dígitos',
  'That’s outside {limit}. What did you do?': 'Eso está fuera de {limit}. ¿Qué hiciste?', 'Check it before the first rack goes through: {limit}.': 'Revísala antes de la primera rejilla: {limit}.',
  'Running low at the bar': 'Lo que se acaba en la barra', 'Changed something else?': '¿Cambiaste otra cosa?', 'Changed a keg or bottle': 'Cambié un barril o una botella',
  'Which one did you change?': '¿Cuál cambiaste?', 'Changed it': 'Ya lo cambié', 'Out': 'Se acabó', 'The last of it': 'Lo último', 'Get the next one ready': 'Prepara el siguiente',
  'The managers have been told.': 'Ya se avisó a los gerentes.', '{n} drink in the last hour.': '{n} bebida en la última hora.', '{n} drinks in the last hour.': '{n} bebidas en la última hora.',
  '{n} more looks fine by the count.': '{n} más se ve bien según el conteo.', '{n} more look fine by the count.': '{n} más se ven bien según el conteo.',
  'Nothing running low. The one thing the bar pours from looks fine by the count.': 'Nada se acaba. Lo único que sirve la barra se ve bien según el conteo.',
  'Nothing running low. All {n} things the bar pours from look fine by the count.': 'Nada se acaba. Las {n} cosas que sirve la barra se ven bien según el conteo.',
};

// Words another part of the app puts together ("4:05 over", "in 3 min", "Sam’s on the way"), said in Spanish.
const PATTERNS: [RegExp, string][] = [
  [/^(\d+:\d\d) over$/, '$1 tarde'], [/^(\d+:\d\d) left$/, 'quedan $1'],
  [/^Table ([^,]+), seat (.+)$/, 'Mesa $1, asiento $2'], [/^Table ([^,]+)$/, 'Mesa $1'],
  [/^(.+), Table ([^,]+), seat (.+)$/, '$1, mesa $2, asiento $3'], [/^(.+), Table ([^,]+)$/, '$1, mesa $2'], [/^(.+), course (\d+)$/, '$1, tiempo $2'],
  [/^Drive-thru (\S+)$/, 'Autoservicio $1'], [/^Counter (\S+)$/, 'Mostrador $1'], [/^Kiosk (\S+)$/, 'Quiosco $1'],
  [/^now$/, 'ahora'], [/^in under a minute$/, 'en menos de un minuto'], [/^in (\d+) min$/, 'en $1 min'],
  [/^(.+)’s on the way$/, '$1 va en camino'], [/^Done, (.+)$/, 'Hecho, $1'], [/^Waiting, (\d+) min$/, 'Esperando, $1 min'],
];

// What a call is for, as the screen that called wrote it: one of the kinds, then any words of their own ("Ice, well 2").
const CALL_WORDS = ['Plates', 'Bowls', 'Pans to the line', 'Cutlery', 'Glasses', 'Something else', 'Ice', 'Change a keg', 'A bottle of…', 'Limes and garnish',
  'Food to run', 'Help at the pass', 'Come to the pass', 'A question about the table', 'Come to the kitchen', 'A comp or a remake'];

/** What the screen says, in its language: the Spanish when there is one, otherwise the English. */
export function tr(lang: Lang, en: string, vars?: Record<string, string | number>): string {
  let out = en;
  if (lang === 'es') {
    if (Object.prototype.hasOwnProperty.call(ES, en)) out = ES[en];
    else {
      const hit = PATTERNS.find(([re]) => re.test(en));
      const kind = hit ? null : CALL_WORDS.find((k) => en.startsWith(`${k}, `));
      out = hit ? en.replace(hit[0], hit[1]) : kind ? `${ES[kind]}${en.slice(kind.length)}` : en;
    }
  }
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}
/** Whether the screen has Spanish for these words (used by the checks). */
export const hasSpanish = (en: string) => Object.prototype.hasOwnProperty.call(ES, en) || PATTERNS.some(([re]) => re.test(en));

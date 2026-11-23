// src/lib/guest-lang.ts — THE GUEST SCREENS IN SPANISH (pure; design board "The boards and the assistant in Spanish",
// A: each screen picks its language). The team's screens already switch (lib/screen-lang); this is what guests read: the
// TV menu boards, the drive-thru order board and the screen at the window; and the kiosk, where each guest picks on the
// start screen and it goes back to the kiosk's own language for the next.
//   - Each screen is set to English or Español on the screen itself (its corner menu, or ?lang=es in its address), and
//     keeps it on that device, so a business can put one of each side by side.
//   - What the screen itself says comes from here, in Spanish that speaks to a guest politely (usted). What the business
//     wrote comes in its own Spanish, set on the Menu page: each item's name and description, each section's name and
//     each menu by time of day. One left blank shows the English, so a half-done menu still reads.
//   - Prices, numbers and times read the same in both ("7 AM"). A guest's choices on an order ("large, no onions") and
//     the shop's products stay as the business wrote them.
//   Stored: an item's nameEs and descriptionEs (on its inventory doc); tenants/{t}.menuSpanish = { sections: { [English
//   section name]: Spanish }, dayparts: { [daypart id]: Spanish } }; an order line made from an item carries its nameEs.
export type GuestLang = 'en' | 'es';
export const GUEST_LANGS: { id: GuestLang; name: string }[] = [{ id: 'en', name: 'English' }, { id: 'es', name: 'Español' }];
export const cleanGuestLang = (v: unknown): GuestLang => (v === 'es' ? 'es' : 'en');
/** Where a screen keeps its language: one key for each kind of screen, so a TV board and a window screen on the same
 *  device can differ. */
export const guestLangKey = (screen: 'menuboard' | 'board' | 'window' | 'kiosk', tenantId: string) => `cf.drivethru.${screen}.lang.${tenantId}`;

export const ES_NAME_MAX = 80, ES_WORDS_MAX = 240, ES_SECTION_MAX = 40, ES_DAYPART_MAX = 30;
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
/** A Spanish name or description as kept (empty: none). */
export const cleanEs = (v: unknown, n: number): string | null => clip(v, n) || null;
/** An item's Spanish name, from its inventory doc (or a line or menu item that carries one). */
export const nameEsOf = (i: any): string | null => cleanEs(i?.nameEs, ES_NAME_MAX);
export const wordsEsOf = (i: any): string | null => cleanEs(i?.descriptionEs ?? i?.wordsEs, ES_WORDS_MAX);

/** The business's Spanish for its sections and its menus by time of day. */
export function spanishOf(tenant: any): { sections: Record<string, string>; dayparts: Record<string, string> } {
  const m = tenant?.menuSpanish || {};
  const map = (o: any, n: number) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).map(([k, v]) => [String(k).slice(0, 60), clip(v, n)]).filter(([k, v]) => k && v).slice(0, 200));
  return { sections: map(m.sections, ES_SECTION_MAX), dayparts: map(m.dayparts, ES_DAYPART_MAX) };
}

/** Items on the menu that still have no Spanish name (the count on the Menu page). */
export const spanishLeft = (items: { onMenu?: boolean; nameEs?: string | null }[]) => items.filter((m) => m.onMenu !== false && !m.nameEs).length;

/** In the screen's language: the Spanish when it has some, otherwise the English. */
export const inLang = (lang: GuestLang, en: string, es: string | null | undefined) => (lang === 'es' && es ? es : en);

// The screens' own words: the English, with {name} for what's filled in, and the Spanish.
const ES: Record<string, string> = {
  // The TV menu board
  'Sold out': 'Agotado', 'Popular': 'Popular', 'New': 'Nuevo', 'Limited time': 'Por poco tiempo', 'Number {n}': 'Número {n}', 'Numbers {a} to {b}': 'Números {a} al {b}',
  '{n} colors': '{n} colores', 'Pros only': 'Solo profesionales', '{n} cal': '{n} cal', 'from': 'desde', 'usually': 'normalmente', 'Featured': 'Destacado',
  'Pickup only: order on your phone': 'Solo para recoger: pida en su teléfono', 'Order ahead': 'Pida por adelantado',
  'Scan with your camera, then pull up': 'Escanee con su cámara y luego avance', 'Scan with your camera': 'Escanee con su cámara',
  'Code to order ahead on your phone': 'Código para pedir por adelantado en su teléfono',
  '{name} is back {at}': '{name} vuelve {at}', '{name} is back tomorrow {at}': '{name} vuelve mañana {at}', 'Nothing’s being served just now.': 'No se está sirviendo nada en este momento.',
  'Order by number or by name': 'Pida por número o por nombre', 'Pros only items need your license on file': 'Los artículos solo para profesionales piden su licencia registrada',
  'The menu isn’t available right now.': 'El menú no está disponible en este momento.', 'Loading the menu': 'Cargando el menú',
  '{a} of {b}': '{a} de {b}', '{name}, part {a} of {b}': '{name}, parte {a} de {b}', '{name} {until}': '{name} {until}', 'Happy hour {until}': 'Hora feliz {until}',
  // The order board by the speaker
  'Welcome': 'Bienvenidos', 'Order {n}': 'Pedido {n}', 'Your order shows here as we take it.': 'Su pedido aparece aquí mientras lo tomamos.',
  'Thank you': 'Gracias', 'Thank you, {name}': 'Gracias, {name}', 'Please pull forward to the window.': 'Por favor, avance a la ventanilla.',
  'We have your order {n}, paid and being made. Anything else?': 'Tenemos su pedido {n}, pagado y en preparación. ¿Algo más?', 'Go ahead whenever you’re ready.': 'Puede ordenar cuando guste.',
  '{n} more item before these': '{n} artículo más antes de estos', '{n} more items before these': '{n} artículos más antes de estos', 'On the house': 'Cortesía de la casa',
  'Total with tax': 'Total con impuestos', 'Total': 'Total',
  // The screen at the window
  'Your order is handed out here.': 'Aquí se entrega su pedido.', 'Your order and total show here at the window.': 'Su pedido y el total aparecen aquí en la ventanilla.',
  'Your total with tax': 'Su total con impuestos', 'Your total': 'Su total', 'Your order placed ahead, {n}, is paid already.': 'Su pedido por adelantado, {n}, ya está pagado.',
  'Tap, insert or swipe your card on the reader': 'Acerque, inserte o deslice su tarjeta en el lector', 'The card didn’t go through.': 'No se pudo procesar la tarjeta.',
  'Try another card, or pay another way.': 'Pruebe con otra tarjeta o pague de otra forma.', 'Code to pay on your phone': 'Código para pagar en su teléfono',
  'Scan to pay on your phone': 'Escanee para pagar en su teléfono',
  'Point your camera at the code. Card, Apple Pay or Google Pay. Or pay at the window.': 'Apunte su cámara al código. Tarjeta, Apple Pay o Google Pay. O pague en la ventanilla.',
  'Point your camera at the code and pay by card. Or pay at the window.': 'Apunte su cámara al código y pague con tarjeta. O pague en la ventanilla.',
  'Card or cash': 'Tarjeta o efectivo', 'We’ll take it at the window.': 'Le cobramos en la ventanilla.',
  'Paid': 'Pagado', 'Paid in cash': 'Pagado en efectivo', 'Paid by card': 'Pagado con tarjeta',
  'You earned {n} points': 'Ganó {n} puntos', 'You earned 1 point': 'Ganó 1 punto', 'You earned {n} punches': 'Ganó {n} sellos', 'You earned 1 punch': 'Ganó 1 sello',
  'Your change': 'Su cambio', 'Please pull up to the next window.': 'Por favor, avance a la siguiente ventanilla.',
  'Your orders are ready, with {n} placed ahead.': 'Sus pedidos están listos, con {n} por adelantado.', 'Your orders are being made, with {n} placed ahead.': 'Sus pedidos se están preparando, con {n} por adelantado.',
  'Your order is ready.': 'Su pedido está listo.', 'Your order is being made.': 'Su pedido se está preparando.',
  'Please pull forward': 'Por favor, avance', 'Please pull forward to': 'Por favor, avance al', 'Spot': 'Lugar',
  'We’ll bring your order right out to you.': 'Le llevamos su pedido enseguida.', 'We’ll bring your order right out to you, {name}.': 'Le llevamos su pedido enseguida, {name}.',
  'Enjoy, and see you next time.': 'Que lo disfrute. ¡Hasta la próxima!', 'Your order': 'Su pedido', 'Subtotal': 'Subtotal', 'Reward: {name}': 'Recompensa: {name}',
  'Tax': 'Impuestos', 'Gift card, not taxed': 'Tarjeta de regalo, sin impuestos', 'Tip': 'Propina',
  // The kiosk
  'Language': 'Idioma', 'Loading': 'Cargando', 'Order here and pay with your card. We’ll call your number when it’s ready.': 'Pida aquí y pague con su tarjeta. Le llamaremos por su número cuando esté listo.',
  'Start your order': 'Empiece su pedido', 'Not taking orders yet': 'Aún no tomamos pedidos aquí', 'Please order at the counter.': 'Por favor, pida en el mostrador.',
  'On today': 'Hoy tenemos', 'Pay on the card reader by this screen.': 'Pague en el lector de tarjetas junto a esta pantalla.',
  'Ordering here is closed for now. Please order at the counter.': 'Por ahora no se toman pedidos aquí. Por favor, pida en el mostrador.',
  'The menu couldn’t be loaded. Try again.': 'No se pudo cargar el menú. Inténtelo de nuevo.',
  'Start over': 'Empezar de nuevo', 'Menu': 'Menú', 'Menu sections': 'Secciones del menú', 'Tap something to add it.': 'Toque algo para agregarlo.',
  '{n} item': '{n} artículo', '{n} items': '{n} artículos', '{n} item, {price}': '{n} artículo, {price}', '{n} items, {price}': '{n} artículos, {price}',
  'Review and pay': 'Revisar y pagar', 'Happy hour price': 'Precio de hora feliz', 'Add': 'Agregar', 'Add {name}': 'Agregar {name}',
  'Added': 'Agregado', 'Changed': 'Cambiado', 'Goes well with it': 'Va bien con esto', 'Size up to {size}': 'Cambiar a {size}', 'Size up to {size}, {price} more': 'Cambiar a {size}, {price} más',
  'No thanks': 'No, gracias', 'Done': 'Listo', 'Note: {note}': 'Nota: {note}', 'How many {name}': 'Cuántos de {name}', 'Take {name} off': 'Quitar {name}',
  'One fewer {name}': 'Uno menos de {name}', 'One more {name}': 'Uno más de {name}', '{name}, sold out': '{name}, agotado', '{name}, {price}': '{name}, {price}',
  'Close': 'Cerrar', '({n} cal)': '({n} cal)', 'Choices can change this.': 'Las opciones pueden cambiar esto.', 'Allergens aren’t listed for this one.': 'No se indican los alérgenos de este artículo.',
  'How many': 'Cuántos', 'One fewer': 'Uno menos', 'One more': 'Uno más', 'Add, {price}': 'Agregar, {price}', 'Add {n}, {price}': 'Agregar {n}, {price}', 'Choose an option.': 'Elija una opción.', 'Check your choices.': 'Revise sus opciones.',
  'Still there?': '¿Sigue ahí?', 'Still ordering?': '¿Sigue ordenando?', 'This order will be canceled in {n} seconds.': 'Este pedido se cancelará en {n} segundos.',
  'We’ll start over in {n} seconds.': 'Empezaremos de nuevo en {n} segundos.', 'I’m still here': 'Sigo aquí', 'Keep ordering': 'Seguir ordenando',
  'Nothing in your order yet.': 'Su pedido está vacío.', 'Add more': 'Agregar más', 'Name and pay': 'Nombre y pago', 'Your first name': 'Su nombre', '(optional)': '(opcional)',
  'So we can call it': 'Para llamarle', 'Leave it empty if there are none.': 'Déjelo vacío si no tiene ninguna.', 'For here or to go': 'Para comer aquí o para llevar',
  'For here or to go?': '¿Para comer aquí o para llevar?', 'For here': 'Para aquí', 'To go': 'Para llevar', 'One moment…': 'Un momento…', 'Pay {price}': 'Pagar {price}',
  'You’ll pay on the card reader. The kitchen starts once it’s paid.': 'Pagará en el lector de tarjetas. La cocina empieza en cuanto se pague.',
  'For {name}': 'Para {name}', 'For': 'Para', ', to go': ', para llevar', ', for here': ', para aquí', 'The card didn’t go through': 'No se pudo procesar la tarjeta', 'That didn’t go through': 'No se pudo completar',
  'Starting…': 'Iniciando…', 'Try again': 'Intentar de nuevo', 'Tap, insert or swipe your card': 'Acerque, inserte o deslice su tarjeta', 'Getting the card reader ready…': 'Preparando el lector de tarjetas…',
  'on the card reader by this screen': 'en el lector de tarjetas junto a esta pantalla', 'Cancel': 'Cancelar',
  'This order was let go. Please start again.': 'Este pedido se canceló. Por favor, empiece de nuevo.', 'The card reader didn’t answer. Try again.': 'El lector de tarjetas no respondió. Inténtelo de nuevo.',
  'Paid. Thank you': 'Pagado. Gracias', 'Paid. Thank you, {name}': 'Pagado. Gracias, {name}', 'Your number': 'Su número', 'We’ll call your number when it’s ready.': 'Le llamaremos por su número cuando esté listo.',
  'It’s ready. We just texted ···{n}.': 'Ya está listo. Le enviamos un mensaje al ···{n}.', 'We’ll text ···{n} when it’s ready.': 'Le enviaremos un mensaje al ···{n} cuando esté listo.',
  'Text me when it’s ready': 'Avíseme por mensaje cuando esté listo', 'Get a receipt': 'Recibir un recibo', 'This screen starts over in a few seconds.': 'Esta pantalla empezará de nuevo en unos segundos.',
  'Your mobile number': 'Su número de celular', 'Ten digits': 'Diez dígitos', 'Number pad': 'Teclado numérico', 'Delete the last digit': 'Borrar el último dígito', 'Clear the number': 'Borrar todo el número',
  'Back': 'Borrar', 'Clear': 'Borrar todo', 'Saving…': 'Guardando…', 'Text me': 'Enviarme un mensaje', 'One text, just for this order.': 'Un solo mensaje, solo para este pedido.',
  'Send it by': 'Enviarlo por', 'Text': 'Mensaje', 'Email': 'Correo', 'Your email': 'Su correo electrónico', 'Sending…': 'Enviando…', 'Send my receipt': 'Enviar mi recibo',
  'A link to your full receipt. Nothing is kept on this screen.': 'Un enlace a su recibo completo. No se guarda nada en esta pantalla.',
  'Your receipt was texted to ···{n}.': 'Le enviamos el recibo por mensaje al ···{n}.', 'Your receipt was emailed.': 'Le enviamos el recibo por correo.',
  'That didn’t go through. Try again.': 'No se pudo completar. Inténtelo de nuevo.', 'No connection. Try again.': 'Sin conexión. Inténtelo de nuevo.',
  // The kiosk's server, as it answers
  'Add something first.': 'Primero agregue algo.', 'Card payments start at $0.50. Add something, or order at the counter.': 'Los pagos con tarjeta empiezan en $0.50. Agregue algo o pida en el mostrador.',
  'Paying by card isn’t set up here yet. Please order at the counter.': 'Aquí todavía no se puede pagar con tarjeta. Por favor, pida en el mostrador.',
  'Something in your order isn’t on the menu any more. Take it off and try again.': 'Algo de su pedido ya no está en el menú. Quítelo e inténtelo de nuevo.',
  'Something in your order just ran out. Change your order and try again.': 'Algo de su pedido se acaba de agotar. Cambie su pedido e inténtelo de nuevo.',
  'Something went wrong. Try again.': 'Algo salió mal. Inténtelo de nuevo.', 'Ten digits, please.': 'Diez dígitos, por favor.',
  'That email doesn’t look right. Check it and try again.': 'Ese correo no parece correcto. Revíselo e inténtelo de nuevo.', 'That order is done here. Ask at the counter.': 'Ese pedido ya terminó aquí. Pregunte en el mostrador.',
  'That order was let go. Please start again.': 'Ese pedido se canceló. Por favor, empiece de nuevo.', 'The card reader is finishing another payment. Try again in a moment.': 'El lector de tarjetas está terminando otro pago. Inténtelo en un momento.',
  'This kiosk’s card reader isn’t picked yet. Please order at the counter.': 'Esta pantalla todavía no tiene lector de tarjetas. Por favor, pida en el mostrador.',
  'Your receipt was already sent. Ask at the counter if you need another.': 'Su recibo ya se envió. Pregunte en el mostrador si necesita otro.',
  // Choices, allergies and notes (the kiosk's, through components/menu)
  'pick one': 'elija uno', 'pick one, if you like': 'elija uno, si lo desea', 'pick up to {n}': 'elija hasta {n}', 'pick any': 'elija los que guste',
  'Any allergies?': '¿Alguna alergia?', 'Another allergy': 'Otra alergia', 'Like mustard': 'Por ejemplo, mostaza', 'It’s severe': 'Es una alergia grave',
  'A note for the kitchen': 'Una nota para la cocina', 'Like no onions': 'Por ejemplo, sin cebolla',
  'Contains {list}': 'Contiene {list}', 'None of the major allergens listed': 'No se indica ningún alérgeno principal',
  'Its allergens aren’t listed. The kitchen sees your allergy on the ticket.': 'No se indican sus alérgenos. La cocina ve su alergia en el pedido.',
};
/** The major allergens in Spanish, for a guest (lib/allergens keys). */
const ALLERGEN_ES: Record<string, string> = { milk: 'Leche', eggs: 'Huevo', fish: 'Pescado', shellfish: 'Mariscos', treenuts: 'Nueces de árbol', peanuts: 'Cacahuate (maní)', wheat: 'Trigo', gluten: 'Gluten', soy: 'Soya', sesame: 'Ajonjolí' };
/** An allergen's name on a guest's screen, in its language. */
export const allergenIn = (lang: GuestLang, key: string, en: string) => (lang === 'es' && ALLERGEN_ES[key] ? ALLERGEN_ES[key] : en);
/** "milk, eggs and wheat", "leche, huevo y trigo". */
export function listIn(lang: GuestLang, words: string[]): string {
  return words.length <= 1 ? (words[0] || '') : `${words.slice(0, -1).join(', ')} ${lang === 'es' ? 'y' : 'and'} ${words[words.length - 1]}`;
}
/** What the server said, in the screen's language: its Spanish when there is some for those words, otherwise the
 *  Spanish of `fallback` (so a guest never reads English they didn't pick); in English, what it said. */
export const sayIn = (lang: GuestLang, said: unknown, fallback: string) => { const t = String(said || ''); return lang === 'es' ? gt('es', t && hasGuestSpanish(t) ? t : fallback) : t || fallback; };

/** What the screen says, in its language: the Spanish when there is some, otherwise the English. */
export function gt(lang: GuestLang, en: string, vars?: Record<string, string | number>): string {
  const out = lang === 'es' && Object.prototype.hasOwnProperty.call(ES, en) ? ES[en] : en;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}
/** Whether the screens have Spanish for these words (used by the checks). */
export const hasGuestSpanish = (en: string) => Object.prototype.hasOwnProperty.call(ES, en);

// One o'clock takes "la" in Spanish ("a la 1 PM"), every other hour "las" ("a las 7 AM").
const one = (time: string) => /^1(:\d\d)?\s?[AP]M$/i.test(time.trim());
/** "at 7 AM", "a las 7 AM", "a la 1 PM". */
export const atTime = (lang: GuestLang, time: string) => (lang === 'es' ? `${one(time) ? 'a la' : 'a las'} ${time}` : `at ${time}`);
/** "until 11 AM", "hasta las 11 AM", "hasta la 1 PM". */
export const untilTime = (lang: GuestLang, time: string) => (lang === 'es' ? `${one(time) ? 'hasta la' : 'hasta las'} ${time}` : `until ${time}`);

/** "You earned 3 points", "Ganó 1 sello". */
export function earnedWords(lang: GuestLang, n: number, unit: string): string {
  const punch = /^punch/.test(unit);
  return n === 1 ? gt(lang, punch ? 'You earned 1 punch' : 'You earned 1 point') : gt(lang, punch ? 'You earned {n} punches' : 'You earned {n} points', { n });
}

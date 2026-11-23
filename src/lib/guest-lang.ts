// src/lib/guest-lang.ts — THE GUEST SCREENS IN SPANISH (pure; design board "The boards and the assistant in Spanish",
// A: each screen picks its language). The team's screens already switch (lib/screen-lang); this is what guests read: the
// TV menu boards, the drive-thru order board and the screen at the window; the kiosk, where each guest picks on the
// start screen and it goes back to the kiosk's own language for the next; and the order-ahead page on the guest's own
// phone, which starts in the phone's language and keeps what they pick (and the text when it's ready goes in it too).
//   - Each screen is set to English or Español on the screen itself (its corner menu, or ?lang=es in its address), and
//     keeps it on that device, so a business can put one of each side by side.
//   - What the screen itself says comes from here, in Spanish that speaks to a guest politely (usted). What the business
//     wrote comes in its own Spanish, set on the Menu page: each item's name and description, each section's name and
//     each menu by time of day. One left blank shows the English, so a half-done menu still reads.
//   - Prices, numbers and times read the same in both ("7 AM"). The drive-thru keeps its name ("el drive-thru"), as US
//     guests say it; "autoservicio" reads as self-service to many. A guest's choices on an order ("large, no onions") and
//     the shop's products stay as the business wrote them.
//   Stored: an item's nameEs and descriptionEs (on its inventory doc); tenants/{t}.menuSpanish = { sections: { [English
//   section name]: Spanish }, dayparts: { [daypart id]: Spanish } }; an order line made from an item carries its nameEs.
export type GuestLang = 'en' | 'es';
export const GUEST_LANGS: { id: GuestLang; name: string }[] = [{ id: 'en', name: 'English' }, { id: 'es', name: 'Español' }];
export const cleanGuestLang = (v: unknown): GuestLang => (v === 'es' ? 'es' : 'en');
/** Where a screen keeps its language: one key for each kind of screen, so a TV board and a window screen on the same
 *  device can differ. */
export const guestLangKey = (screen: 'menuboard' | 'board' | 'window' | 'kiosk' | 'ahead', tenantId: string) => `cf.drivethru.${screen}.lang.${tenantId}`;
/** The language an order was placed in, as kept on it (`order.guestLang`, only when it's Spanish). */
export const orderLangOf = (order: any): GuestLang => cleanGuestLang(order?.guestLang);

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
  'Delete': 'Borrar', 'Clear': 'Borrar todo', 'Saving…': 'Guardando…', 'Text me': 'Enviarme un mensaje', 'One text, just for this order.': 'Un solo mensaje, solo para este pedido.',
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
  // The order-ahead page: the menu
  'Back': 'Volver', 'Order ahead, pay now, and pick it up {ways}.': 'Pida por adelantado, pague ahora y recójalo {ways}.',
  'Order ahead, pay now, and pick it up {ways}, or have it delivered.': 'Pida por adelantado, pague ahora y recójalo {ways}, o pida que se lo llevemos.',
  'Order ahead, pay now, and have it delivered.': 'Pida por adelantado, pague ahora y se lo llevamos.',
  'at the drive-thru': 'en el drive-thru', 'inside': 'adentro', 'at the curb: we bring it to your car': 'en la acera: se lo llevamos a su auto', 'delivered to you': 'a domicilio',
  'Drive-thru': 'Drive-thru', 'Inside': 'Adentro', 'Curbside': 'En la acera', 'Delivery': 'A domicilio', '{a} or {b}': '{a} o {b}',
  'From': 'Desde', 'Change': 'Cambiar', 'Too late for pickup today.': 'Ya es tarde para recoger hoy.', 'Closed right now.': 'Cerrado en este momento.',
  'We open again {when}.': 'Abrimos de nuevo {when}.', 'You can order for another day now.': 'Ya puede pedir para otro día.', 'You can look through the menu now.': 'Ya puede ver el menú.',
  'Order again': 'Pedir de nuevo', 'Favorite: {words}': 'Favorito: {words}', 'Your favorite': 'Su favorito', 'Today': 'Hoy', 'Yesterday': 'Ayer',
  'Add to order: {words}': 'Agregar al pedido: {words}', 'Add to order': 'Agregar al pedido', 'From {price}': 'Desde {price}', 'View order': 'Ver pedido',
  '{name} isn’t on the menu now': '{name} ya no está en el menú', '{name} is sold out right now': '{name} está agotado en este momento',
  '{name} has new choices, so add it from the menu': '{name} tiene opciones nuevas, así que agréguelo desde el menú', 'Added to your order.': 'Agregado a su pedido.',
  'Nothing could be added.': 'No se pudo agregar nada.', 'For today, up to 20 of each. Check your order.': 'Para hoy, hasta 20 de cada uno. Revise su pedido.',
  'Ordering ahead isn’t on right now. Order when you get here.': 'Por ahora no se puede pedir por adelantado. Pida cuando llegue.',
  // …an item, and what's offered with it
  'Added to your order': 'Agregado a su pedido', 'Anything with it?': '¿Algo para acompañar?', '{price} for all': '{price} por todos', 'Changed to {size}.': 'Cambiado a {size}.',
  '{name} added.': 'Se agregó {name}.',
  // …where from (more than one location)
  'Where are you ordering from?': '¿En qué local quiere pedir?', 'Finding you…': 'Buscando su ubicación…', 'Find the nearest': 'Buscar el más cercano', 'Locations': 'Locales',
  'This phone can’t share where it is. Pick from the list.': 'Este teléfono no puede compartir su ubicación. Elija de la lista.',
  'We couldn’t tell where you are. Pick from the list.': 'No pudimos saber dónde está. Elija de la lista.', 'Nearest to you': 'El más cercano a usted',
  'Open': 'Abierto', 'Closed': 'Cerrado', 'Open {until}': 'Abierto {until}', 'Opens {when}': 'Abre {when}', 'tomorrow {at}': 'mañana {at}', 'on {day} {at}': 'el {day} {at}',
  // …the order, how and when
  'Back to the menu': 'Volver al menú', 'Nothing yet.': 'Nada todavía.', 'Take off {name}': 'Quitar {name}', 'Delivery fee': 'Costo de envío', 'Free': 'Gratis',
  'Driver tip': 'Propina del repartidor', 'Any tax is added on the next step.': 'Los impuestos se agregan en el siguiente paso.', 'Name for the order': 'Nombre para el pedido', 'First name': 'Nombre',
  'On every ticket in the kitchen. Leave it empty if there are none.': 'Aparece en cada orden de la cocina. Déjelo vacío si no tiene ninguna.',
  'Check the dishes marked above before paying. The kitchen sees your allergy either way.': 'Revise los platillos marcados arriba antes de pagar. La cocina ve su alergia de todos modos.',
  'Phone': 'Teléfono', '(so the driver can reach you)': '(para que el repartidor pueda comunicarse con usted)', '(so we can reach you about it)': '(para comunicarnos con usted sobre el pedido)',
  'Phone number': 'Número de teléfono', 'It earns your points.': 'Con él gana sus puntos.', 'It earns your punches.': 'Con él gana sus sellos.',
  'Text me when it’s on its way': 'Avíseme por mensaje cuando vaya en camino', 'Join the rewards program, if I haven’t already': 'Unirme al programa de recompensas, si aún no lo he hecho',
  'When do you want it?': '¿Para cuándo lo quiere?', 'Another day': 'Otro día', 'For catering and big orders.': 'Para banquetes y pedidos grandes.',
  'A day’s notice': 'Con un día de anticipación', '{n} days’ notice': 'Con {n} días de anticipación', '{n} hours’ notice': 'Con {n} horas de anticipación', '{notice}, picked up or delivered.': '{notice}, para recoger o a domicilio.',
  'How you’ll get it': 'Cómo lo recibe', 'How you’ll pick it up': 'Cómo lo recoge', 'Park and tap I’m here when you arrive. We’ll bring it to your car.': 'Estaciónese y toque Ya llegué cuando llegue. Se lo llevamos a su auto.',
  'Delivered to you': 'A domicilio', 'Pick up:': 'Para recoger:', 'When it gets to you': 'Cuándo le llega', 'Check the address to see the days and times.': 'Revise la dirección para ver los días y las horas.',
  'The day, and when it gets to you': 'El día y cuándo le llega', 'The day and time': 'El día y la hora', 'Too late for pickup today': 'Ya es tarde para recoger hoy', 'Closed right now': 'Cerrado en este momento',
  'We open again {when}. Order ahead then.': 'Abrimos de nuevo {when}. Pida por adelantado entonces.', 'We open again {when}. Order ahead then, or order for another day.': 'Abrimos de nuevo {when}. Pida por adelantado entonces, o pida para otro día.',
  'You can order for another day.': 'Puede pedir para otro día.', 'We’re not taking orders for pickup today.': 'Hoy no estamos tomando pedidos para recoger.',
  'Check the address to see when it can get to you.': 'Revise la dirección para ver cuándo le puede llegar.', 'When': 'Cuándo', 'We open {when}. Pick a time from then.': 'Abrimos {when}. Elija una hora a partir de entonces.',
  'As soon as it’s ready': 'En cuanto esté listo', 'As soon as it’s ready, about {time}': 'En cuanto esté listo, alrededor de {time}', 'No driver free': 'Sin repartidor libre', 'Full right now': 'Lleno en este momento', 'Full': 'Lleno', 'Chosen': 'Elegido',
  'Times marked full: our drivers are out then.': 'Las horas marcadas como llenas: nuestros repartidores están ocupados.', 'Fewer times': 'Menos horas', 'Later times': 'Más horas',
  'Last delivery about {time}.': 'Última entrega alrededor de {time}.', 'Last pickup {time}.': 'Última hora para recoger: {time}.',
  'The kitchen is busy right now, so orders are taking about {n} minutes longer than usual.': 'La cocina está ocupada ahora, así que los pedidos tardan unos {n} minutos más de lo normal.',
  'The kitchen is busy right now, so orders are taking about {n} minutes longer than usual, and pickup times fill faster.': 'La cocina está ocupada ahora, así que los pedidos tardan unos {n} minutos más de lo normal, y las horas para recoger se llenan más rápido.',
  'The kitchen is busy right now, so orders are taking about 1 minute longer than usual.': 'La cocina está ocupada ahora, así que los pedidos tardan un minuto más de lo normal.',
  'The kitchen is busy right now, so orders are taking about 1 minute longer than usual, and pickup times fill faster.': 'La cocina está ocupada ahora, así que los pedidos tardan un minuto más de lo normal, y las horas para recoger se llenan más rápido.',
  'The kitchen’s full right now. Please try again in a few minutes.': 'La cocina está llena en este momento. Inténtelo de nuevo en unos minutos.',
  'Check the address first': 'Primero revise la dirección', 'Pick a day and time': 'Elija un día y una hora', 'Add a little more': 'Agregue un poco más', 'Continue to pay': 'Continuar al pago',
  'Too late for today': 'Ya es tarde para hoy', 'Pick a delivery time': 'Elija una hora de entrega', 'Pick a pickup time': 'Elija una hora para recoger',
  'You pay now, and it’s made on its day.': 'Paga ahora y se prepara ese día.', 'You pay now, and we bring it to you.': 'Paga ahora y se lo llevamos.', 'You pay now, so it’s ready when you get here.': 'Paga ahora, así estará listo cuando llegue.',
  'How will you get it?': '¿Cómo lo va a recibir?', 'How will you pick it up?': '¿Cómo lo va a recoger?', 'What name should we put on the order?': '¿A nombre de quién ponemos el pedido?',
  'A 10-digit phone number, or leave it empty.': 'Un número de 10 dígitos, o déjelo vacío.', 'Check the address first.': 'Primero revise la dirección.',
  'Add your phone number so the driver can reach you.': 'Agregue su número de teléfono para que el repartidor pueda comunicarse con usted.',
  'Add your mobile number for the text, or untick Text me when it’s ready.': 'Agregue su número de celular para el mensaje, o desmarque Avíseme por mensaje cuando esté listo.',
  'Add your mobile number for the text, or untick Text me when it’s on its way.': 'Agregue su número de celular para el mensaje, o desmarque Avíseme por mensaje cuando vaya en camino.',
  'Pick a day and a time.': 'Elija un día y una hora.', 'Add your phone number, so we can reach you about your order.': 'Agregue su número de teléfono para poder comunicarnos con usted sobre su pedido.',
  'Orders for another day start at {price} before tax.': 'Los pedidos para otro día empiezan en {price} antes de impuestos.',
  'Orders for another day start at {price} before tax. Add {more} more.': 'Los pedidos para otro día empiezan en {price} antes de impuestos. Agregue {more} más.',
  // …another day
  'There are no days to order for right now.': 'Por ahora no hay días disponibles para pedir.', 'Day': 'Día', 'Fewer days': 'Menos días', 'More days': 'Más días', 'Pickup time': 'Hora para recoger',
  'Pick a day to see its times.': 'Elija un día para ver sus horas.', 'How many people?': '¿Para cuántas personas?',
  'Paid now. Cancel for a full refund until {when}.': 'Se paga ahora. Puede cancelar con reembolso completo hasta {when}.',
  // …delivered
  'Tip for your driver': 'Propina para su repartidor', 'None': 'Ninguna', 'Other': 'Otra', 'Tip amount': 'Monto de la propina', 'All of it goes to your driver.': 'Todo es para su repartidor.',
  'Street address': 'Dirección', 'Apt or suite': 'Apto. o suite', 'Optional': 'Opcional', 'Town or city': 'Ciudad', 'State': 'Estado', 'ZIP code': 'Código postal',
  'Notes for the driver': 'Notas para el repartidor', 'Side door, gate code': 'Puerta lateral, código del portón', 'We deliver there.': 'Hacemos entregas ahí.',
  'From {name}, about a {n}-minute drive.': 'Desde {name}, a unos {n} minutos en auto.', 'About a {n}-minute drive.': 'A unos {n} minutos en auto.',
  'Delivery is free for this order.': 'El envío es gratis para este pedido.', 'Delivery {price}.': 'Envío: {price}.', 'Checking…': 'Revisando…', 'Check the address': 'Revisar la dirección',
  'Add the street address, town, state and ZIP code.': 'Agregue la dirección, la ciudad, el estado y el código postal.',
  'We’re not taking deliveries for a little while. Pick it up instead, or try again after {time}.': 'Por un rato no estamos haciendo entregas. Recójalo o inténtelo de nuevo después de {time}.',
  // …paying
  'With {fee} for delivery.': 'Incluye {fee} de envío.', 'With {fee} for delivery and a {tip} tip for your driver.': 'Incluye {fee} de envío y {tip} de propina para su repartidor.',
  'Pay': 'Pagar', 'Paying…': 'Pagando…', 'Your card goes straight to the card company’s secure form. The business never sees it.': 'Su tarjeta va directo al formulario seguro de la compañía de tarjetas. El negocio nunca la ve.',
  'The payment didn’t go through.': 'No se pudo procesar el pago.', 'We couldn’t confirm the payment. Try again in a moment.': 'No pudimos confirmar el pago. Inténtelo de nuevo en un momento.',
  'Refund on its way': 'Reembolso en camino', 'Going through…': 'En proceso…', 'Your payment is still going through. This page updates once it’s done.': 'Su pago todavía está en proceso. Esta página se actualiza cuando termine.',
  'Your payment is going back to your card. It can take a few days to show.': 'Su pago se le devolverá a su tarjeta. Puede tardar unos días en aparecer.',
  // The order's own page
  'Loading your order': 'Cargando su pedido', 'Canceled': 'Cancelado', 'You canceled order {n} for {day}.': 'Usted canceló el pedido {n} para el {day}.',
  '{business} canceled order {n} for {day}.': '{business} canceló el pedido {n} para el {day}.', 'The business': 'El negocio',
  '{price} is on its way back to your card. It can take a few days to show.': 'Le devolvemos {price} a su tarjeta. Puede tardar unos días en aparecer.',
  'Start a new order': 'Empezar un pedido nuevo', 'This order couldn’t be made': 'No se pudo preparar este pedido', 'Something in it ran out.': 'Algo del pedido se agotó.',
  'Waiting for your payment': 'Esperando su pago', 'This page updates once it’s gone through.': 'Esta página se actualiza cuando se procese.', 'Start another order': 'Empezar otro pedido',
  'Picked up. Enjoy!': 'Recogido. ¡Buen provecho!', 'Ready': 'Listo', 'We’ll start it in time for {time}': 'Lo empezaremos a tiempo para {time}', 'Waiting to start': 'Esperando para empezar', 'Being made': 'En preparación',
  'At the speaker, say: “I ordered ahead, code {code}.”': 'En la bocina, diga que pidió por adelantado y su código: {code}.',
  'Tap I’m on my way when you set off, and I’m here when you park. We’ll bring it to your car.': 'Toque Voy en camino al salir, y Ya llegué al estacionarse. Se lo llevamos a su auto.',
  'Say your code at the counter: {code}.': 'Diga su código en el mostrador: {code}.', 'Your pickup code': 'Su código para recoger', 'Order': 'Pedido', 'for {name}': 'para {name}',
  'drive-thru': 'drive-thru', 'curbside': 'en la acera', 'pick up inside': 'recoger adentro', 'At': 'En',
  'You earned {n} points with this order.': 'Ganó {n} puntos con este pedido.', 'You earned 1 point with this order.': 'Ganó 1 punto con este pedido.',
  'You earned {n} punches with this order.': 'Ganó {n} sellos con este pedido.', 'You earned 1 punch with this order.': 'Ganó 1 sello con este pedido.',
  'Telling them…': 'Avisando…', 'I’m in the drive-thru line': 'Estoy en la fila del drive-thru', 'I’m here': 'Ya llegué', 'I’m on my way': 'Voy en camino',
  'They know you’re on your way.': 'Ya saben que va en camino.', 'They know you’re here.': 'Ya saben que llegó.', 'Order this again': 'Pedir esto de nuevo', 'Favorite': 'Favorito',
  'Allergy told to the kitchen: {list}': 'Alergia avisada a la cocina: {list}', 'severe': 'grave',
  // …booked for another day
  'Booked': 'Reservado', 'delivered to {to}': 'entregado en {to}', 'brought to your car': 'llevado a su auto', 'picked up inside': 'recogido adentro', 'for {n} people': 'para {n} personas',
  'It’s made on the day, in time for you.': 'Se prepara ese día, a tiempo para usted.', 'Finish the refund': 'Terminar el reembolso', 'Cancel and refund {price}': 'Cancelar y reembolsar {price}',
  'Cancel your order and get {price} back on your card?': '¿Cancelar su pedido y recibir {price} de vuelta en su tarjeta?', 'Yes, cancel it': 'Sí, cancelarlo', 'Keep it': 'No cancelar',
  'You can cancel for a full refund until {when}.': 'Puede cancelar con reembolso completo hasta {when}.', 'The time to cancel for a refund has passed.': 'Ya pasó el plazo para cancelar con reembolso.',
  'Not all of your refund went through. Tap Finish the refund to try again.': 'No se completó todo su reembolso. Toque Terminar el reembolso para intentarlo de nuevo.',
  // …curbside
  'Say where you are: your car, its color, or the spot.': 'Díganos dónde está: su auto, su color o el lugar.', 'On its way out to you': 'Se lo llevamos ahora',
  '{name} is bringing it to your car.': '{name} se lo lleva a su auto.', 'Someone’s bringing it to your car.': 'Alguien se lo lleva a su auto.', 'We can see you’re here.': 'Vemos que ya llegó.',
  'Where did you park?': '¿Dónde se estacionó?', 'What are you driving?': '¿Qué auto maneja?', 'Your car, or the spot': 'Su auto o el lugar', 'Where are you?': '¿Dónde está?',
  'Optional: its color and make.': 'Opcional: el color y la marca.', 'Your car, its color, or the spot number': 'Su auto, su color o el número del lugar',
  'We’ll ask your phone where you are to say how far away you are. While this page is open, it also checks you in when you pull in.': 'Le pediremos a su teléfono su ubicación para decir qué tan lejos está. Mientras esta página esté abierta, también avisa que llegó cuando se estacione.',
  'Anything we should know?': '¿Algo que debamos saber?', 'Optional, like “please knock”': 'Opcional, por ejemplo, “por favor, toque”', 'Tell them I’m on my way': 'Avisar que voy en camino',
  'Tell them I’m here': 'Avisar que ya llegué', 'Not now': 'Ahora no', 'Checked in by your location.': 'Le registramos por su ubicación.',
  'They know you’re outside. We’ll bring it out.': 'Ya saben que está afuera. Se lo llevamos.', 'They know you’re outside: {where}. We’ll bring it out.': 'Ya saben que está afuera: {where}. Se lo llevamos.',
  'Moved? Say where you are now': '¿Se movió? Díganos dónde está ahora', 'They know you’re on your way, about {n} minutes out.': 'Ya saben que va en camino, a unos {n} minutos.',
  'Keep this page open, and we’ll check you in when you pull in.': 'Mantenga esta página abierta y avisaremos que llegó cuando se estacione.',
  // …the text when it's ready
  'We texted ···{n} that it’s ready.': 'Le enviamos un mensaje al ···{n} de que ya está listo.', 'We texted ···{n} that it’s on its way.': 'Le enviamos un mensaje al ···{n} de que ya va en camino.',
  'We’ll text you at ···{n} when it’s ready.': 'Le enviaremos un mensaje al ···{n} cuando esté listo.', 'We’ll text you at ···{n} when it’s on its way.': 'Le enviaremos un mensaje al ···{n} cuando vaya en camino.',
  'Don’t text me': 'No me envíe mensajes',
  // …delivered
  'Delivered. Enjoy!': 'Entregado. ¡Buen provecho!', 'On its way': 'En camino', 'Couldn’t be delivered': 'No se pudo entregar', 'Picking it up': 'Lo va a recoger', 'Picked up': 'Recogido',
  'Refunded': 'Reembolsado', 'Ready, going out soon': 'Listo, sale pronto', 'Delivered {at}': 'Entregado {at}', 'Delivered': 'Entregado', 'We couldn’t get it to you': 'No pudimos entregárselo',
  'Come pick it up': 'Venga a recogerlo', '{price} is on its way back to your card': 'Le devolvemos {price} a su tarjeta', 'There around {time}': 'Llega alrededor de {time}', 'On its way soon': 'Sale pronto',
  'Paid. The kitchen starts it in time.': 'Pagado. La cocina lo empieza a tiempo.', 'Paid, being made': 'Pagado, en preparación', 'Left with {driver} {at}': 'Salió con {driver} {at}', 'Left {at}': 'Salió {at}',
  'Out with a driver': 'Con el repartidor', 'Running a little late. It was due {at}.': 'Va un poco tarde. Debía llegar {at}.', 'It can take a few days to show.': 'Puede tardar unos días en aparecer.',
  'Your pickup code is': 'Su código para recoger es', ': say it at the counter.': ': dígalo en el mostrador.', 'to {to}': 'para entregar en {to}',
  'The rest is still going back to your card. The team is on it.': 'El resto todavía se está devolviendo a su tarjeta. El equipo se está encargando.',
  'How it’s going': 'Cómo va', '(done)': '(listo)', 'Your driver is outside.': 'Su repartidor está afuera.', 'Left at the door': 'Lo dejaron en la puerta',
  'Where your order was left': 'Dónde se dejó su pedido', 'Your order, delivered': 'Su pedido, entregado',
  // …couldn't be delivered (lib/food-delivery FOOD_FAIL_REASONS)
  'No one answered': 'Nadie respondió', 'Couldn’t get in': 'No se pudo entrar', 'Wrong or missing address': 'La dirección estaba mal o faltaba', 'Something else': 'Otro motivo', 'Couldn’t deliver': 'No se pudo entregar',
  'no one answers': 'nadie responde', 'the driver can’t get in': 'el repartidor no puede entrar', 'the address is wrong or missing': 'la dirección está mal o falta',
  'What would you like?': '¿Qué prefiere?', 'I’ll pick it up': 'Lo recojo yo', 'Refund me {price}': 'Reembolsarme {price}', 'Refund {price} to your card?': '¿Reembolsar {price} a su tarjeta?', 'Yes, refund it': 'Sí, reembolsar',
  'If you pick it up, your {tip} tip and the {fee} delivery fee come back to your card.': 'Si lo recoge, se le devuelven a su tarjeta la propina de {tip} y el costo de envío de {fee}.',
  'If you pick it up, your {tip} tip comes back to your card.': 'Si lo recoge, se le devuelve a su tarjeta la propina de {tip}.',
  'If you pick it up, the {fee} delivery fee comes back to your card.': 'Si lo recoge, se le devuelve a su tarjeta el costo de envío de {fee}.',
  'The {fee} delivery fee isn’t refunded when {when}.': 'El costo de envío de {fee} no se reembolsa cuando {when}.', 'The {fee} delivery fee isn’t refunded in this case.': 'El costo de envío de {fee} no se reembolsa en este caso.',
  'Your refund started but didn’t finish. Tap Refund me to finish it.': 'Su reembolso empezó pero no terminó. Toque Reembolsarme para terminarlo.',
  // The order-ahead server, as it answers (lib/counter-ahead, lib/ahead-days-server, api/counter/ahead)
  'This page isn’t here.': 'Esta página no está aquí.', 'This order isn’t here.': 'Este pedido no está aquí.', 'This order is done.': 'Este pedido ya terminó.',
  'This link doesn’t work. Check the link you were sent.': 'Este enlace no funciona. Revise el enlace que le enviaron.', 'Ordering ahead isn’t on here right now.': 'Por ahora no se puede pedir por adelantado aquí.',
  'Paying online isn’t set up here yet.': 'Aquí todavía no se puede pagar en línea.', 'Pick where you’re ordering from.': 'Elija el local donde quiere pedir.',
  'Orders for another day aren’t taken here right now.': 'Por ahora no se toman pedidos para otro día.', 'Orders for another day are picked up inside, or delivered.': 'Los pedidos para otro día se recogen adentro o se llevan a domicilio.',
  'How many people: 1 to 500, or leave it empty.': 'Cuántas personas: de 1 a 500, o déjelo vacío.', 'Pick the day and time again.': 'Elija el día y la hora de nuevo.', 'Pick a pickup time again.': 'Elija de nuevo una hora para recoger.',
  'That number can’t get texts. Check it, or untick Text me.': 'Ese número no puede recibir mensajes. Revíselo o desmarque la opción de mensaje.', 'Pick a tip again.': 'Elija la propina de nuevo.',
  'Orders paid online start at $0.50.': 'Los pedidos pagados en línea empiezan en $0.50.', 'Deliveries are taking a little longer right now. Pick a later time.': 'Las entregas están tardando un poco más ahora. Elija una hora más tarde.',
  'Our drivers are all out then. Pick a later time.': 'Nuestros repartidores están todos ocupados a esa hora. Elija una hora más tarde.', 'Our drivers are all out right now. Pick a later time.': 'Nuestros repartidores están todos ocupados ahora. Elija una hora más tarde.',
  'We’re not open yet. Pick a pickup time.': 'Todavía no abrimos. Elija una hora para recoger.', 'We’re closed right now, so we can’t take an order for pickup today.': 'Estamos cerrados ahora, así que no podemos tomar pedidos para recoger hoy.',
  'That pickup time just filled up. Pick another time.': 'Esa hora para recoger se acaba de llenar. Elija otra hora.', 'The kitchen’s full for the next few minutes. Pick a time a little later.': 'La cocina está llena los próximos minutos. Elija una hora un poco más tarde.',
  'That order was closed. Start a new one.': 'Ese pedido se cerró. Empiece uno nuevo.', 'Paying isn’t working right now. Try again in a moment.': 'Los pagos no funcionan en este momento. Inténtelo de nuevo en un momento.',
  'We couldn’t reach card payments just now. Try again in a moment.': 'No pudimos conectar con los pagos con tarjeta. Inténtelo de nuevo en un momento.',
  'Delivery isn’t on here right now. Pick it up instead.': 'Por ahora no hacemos entregas aquí. Recójalo.', 'None of our locations deliver right now. Pick it up instead.': 'Ninguno de nuestros locales hace entregas ahora. Recójalo.',
  'Where it would come from just changed. Check the address again.': 'Cambió el local de donde saldría. Revise la dirección de nuevo.', 'We don’t deliver to that address yet. Pick it up instead.': 'Todavía no hacemos entregas a esa dirección. Recójalo.',
  'That’s farther than we deliver. Pick it up instead.': 'Está más lejos de donde hacemos entregas. Recójalo.',
  'We’re not taking deliveries for a little while. Pick it up instead, or try again later.': 'Por un rato no estamos haciendo entregas. Recójalo o inténtelo más tarde.',
  'Your order is for another day. Tap I’m here when you come for it.': 'Su pedido es para otro día. Toque Ya llegué cuando venga a recogerlo.', 'This order is being delivered to you.': 'Este pedido se le está llevando a domicilio.',
  'This order isn’t paid yet.': 'Este pedido todavía no está pagado.', 'This order isn’t for curbside.': 'Este pedido no es para recoger en la acera.',
  'Once it’s paid, you can ask for a text.': 'Cuando esté pagado, puede pedir un mensaje.', 'Pick it up, or a refund?': '¿Recogerlo o un reembolso?',
  'That payment didn’t start. Try again.': 'Ese pago no empezó. Inténtelo de nuevo.', 'Your payment is still going through.': 'Su pago todavía está en proceso.',
  'That payment was called off. Start your order again.': 'Ese pago se canceló. Empiece su pedido de nuevo.', 'Something went wrong. Try again in a moment.': 'Algo salió mal. Inténtelo de nuevo en un momento.',
  'That order is being canceled.': 'Ese pedido se está cancelando.', 'That’s being done now. Give it a moment.': 'Eso se está haciendo ahora. Espere un momento.',
  'Some of it was refunded at the counter already, so it can’t be canceled here. A manager refunds the rest at the counter.': 'Parte ya se reembolsó en el mostrador, así que no se puede cancelar aquí. Un gerente reembolsa el resto en el mostrador.',
  'A refund for it was started. Refund it again to finish.': 'Se empezó un reembolso. Reembólselo de nuevo para terminar.', 'It isn’t waiting to be picked up.': 'No está esperando a que lo recojan.',
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

// One o'clock takes "la" in Spanish ("a la 1 PM"), every other hour "las" ("a las 7 AM"). (A phone set to Spanish
// writes its own times: "1:00 p. m.")
const one = (time: string) => /^1(:\d\d)?(\s?[ap]\.?\s?m\.?)?$/i.test(time.trim());
/** "7:00 PM", "las 7:00 PM", "la 1:00 PM": a time after a word like "para" or "de". */
export const theHour = (lang: GuestLang, time: string) => (lang === 'es' ? `${one(time) ? 'la' : 'las'} ${time}` : time);
/** The first letter as a capital ("viernes 8 de mayo" starting a line). */
export const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** "at 7 AM", "a las 7 AM", "a la 1 PM". */
export const atTime = (lang: GuestLang, time: string) => (lang === 'es' ? `${one(time) ? 'a la' : 'a las'} ${time}` : `at ${time}`);
/** "until 11 AM", "hasta las 11 AM", "hasta la 1 PM". */
export const untilTime = (lang: GuestLang, time: string) => (lang === 'es' ? `${one(time) ? 'hasta la' : 'hasta las'} ${time}` : `until ${time}`);

/** "You earned 3 points", "Ganó 1 sello". */
export function earnedWords(lang: GuestLang, n: number, unit: string): string {
  const punch = /^punch/.test(unit);
  return n === 1 ? gt(lang, punch ? 'You earned 1 punch' : 'You earned 1 point') : gt(lang, punch ? 'You earned {n} punches' : 'You earned {n} points', { n });
}

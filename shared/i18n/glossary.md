# Estori translation glossary

The rules for writing Estori's Spanish (`es`) and Brazilian Portuguese (`pt-BR`). The English text in the code is the key; the catalogs in `shared/i18n/catalogs/` hold the translations. Use this file whenever you add or review a translation, and add any new product term here in the same change.

**The one rule:** one word per concept. If a term is in the table, use exactly that word every time, in every sentence, button and email. If you need a new term, add a row first.

## Languages and tone

| | Español (`es`) | Português (Brasil) (`pt-BR`) |
| --- | --- | --- |
| Variety | Latin American, neutral, with Mexican usage where words differ ("celular", "computadora", "clic") | Brazilian |
| Address | "tú" ("tu", "tienes"). Never "usted" or "vos". | "você" ("seu", "sua"). Never "tu", "teu" or "o senhor". |
| Voice | Friendly and direct: short sentences, active voice, say what happened and what to do next. No blame, no corporate stiffness. | Same: friendly, direct, plain Brazilian Portuguese, the way a helpful colleague would say it. |
| Buttons, menu items, labels | Infinitive: "Guardar", "Cancelar", "Publicar". | Infinitive: "Salvar", "Cancelar", "Publicar". |
| Instructions in a sentence | "tú" imperative: "Revisa tu tarjeta", "Inténtalo de nuevo". | "você" imperative: "Confira seu cartão", "Tente novamente". |
| Punctuation | Opening marks are required: "¿Quieres publicar tu tienda?", "¡Listo!". | Brazilian punctuation; no opening marks. |
| Avoid | Peninsular forms: "vosotros", "ordenador", "móvil", "coger", "vale". | European forms: "utilizador", "ecrã", "telemóvel", "gerir" (use "gerenciar"), "ficheiro" (use "arquivo"). |
| Spelling | RAE standard, Latin American usage. | Brazilian spelling; "e-mail" with the hyphen. |

## Never translate

- **Brand and plan names:** Estori, Basic, Pro, Premium, Enterprise. They take the target language's grammar around them ("la comisión de Estori", "o plano Pro"), but the names stay as written.
- **Other companies and products:** Stripe, GitHub, Google, Apple Pay, Google Pay, Visa, Mastercard, American Express, Cloudflare.
- **Main:** the name of a store's first draft. It is a name, not a word ("Main", never "Principal").
- **Anything the seller or shopper wrote:** store names, draft names, product names, chat messages, file names, addresses.
- **Code and addresses:** URLs, domains (`estori.app`), DNS record types (A, CNAME, TXT), file paths, environment names, keyboard keys.
- **Placeholders and tags:** `{name}`, `{count}`, `{date}` and tags such as `<link>…</link>` appear in the translation exactly as in the English. They may move, so the sentence reads naturally, but none may be added, dropped or renamed.
- **The legal documents:** the Terms and the Privacy Policy stay in English and binding. A link's label may be translated, but where a sentence suggests the document is translated, say it is in English ("en inglés", "em inglês").

## Writing rules

- **Sentence case** for buttons, headings and labels, as in English: "Guardar tarjeta", not "Guardar Tarjeta".
- **Placeholders carry values.** Money, numbers and dates arrive formatted for the language by `formatUsd`, `formatCents`, `formatCredits` and `formatBillingDate`. Never type an amount, a date or a count into a translation.
- **Money is US dollars** and reads the local way: "$49" (English), "USD 49" (Spanish), "US$ 49" (Portuguese). Don't write "pesos" or "reais" for it, and don't type the amount yourself.
- **Never name suppliers or AI assistants**, in any language; seller-facing copy follows `src/routes/copy-rules.ts`. "The AI" is fine: "la IA", "a IA".
- **Plurals** have an `one` and an `other` form. Don't hard-code "1" or "un/uma" in a plural message; the count is a placeholder. Spanish uses `one` for 1; Portuguese uses it for 0 and 1.
- **Length:** Spanish and Portuguese run 20 to 30 percent longer than English. Buttons and badges must still fit. Shorten with a shorter synonym from the table, never by dropping meaning.
- **Quotes and ellipses** are copied from the English: straight quotes around a user's name (`'{name}'`), and the single character "…".
- **Gender:** don't use "(a)", "@" or "x". Write to "tú" and "você", which carry no gender. Where a group noun is unavoidable, use the plain plural ("vendedores", "compradores").
- **"Live" is not "en vivo" or "ao vivo".** Those mean a live broadcast. A live store is a published one.
- **Errors** say what happened and what to do: "No se pudo guardar. Inténtalo de nuevo." / "Não foi possível salvar. Tente novamente."

## Anchor phrases

These set the voice. Translate new copy to match them.

| English | Español | Português |
| --- | --- | --- |
| Save card | Guardar tarjeta | Salvar cartão |
| Renews on {date} | Se renueva el {date} | Renova em {date} |
| Your store is live | Tu tienda está publicada | Sua loja está no ar |
| Take your store offline? | ¿Quieres despublicar tu tienda? | Deseja tirar sua loja do ar? |
| Something went wrong. Try again. | Algo salió mal. Inténtalo de nuevo. | Algo deu errado. Tente novamente. |
| You have {count} AI credits left | Te quedan {count} créditos de IA | Você tem {count} créditos de IA restantes |
| Unpublished changes | Cambios sin publicar | Alterações não publicadas |
| Pay {amount} | Pagar {amount} | Pagar {amount} |

## Terms

### Your store

| English | Español | Português |
| --- | --- | --- |
| store | tienda | loja |
| site (a website that isn't a store) | sitio | site |
| live store (the published one) | tienda publicada | loja no ar |
| draft | borrador | rascunho |
| Main (a draft's name) | Main | Main |
| preview | vista previa | pré-visualização |
| template | plantilla | template |
| product | producto | produto |
| catalog | catálogo | catálogo |
| supplier catalog | catálogo de proveedores | catálogo de fornecedores |
| supplier | proveedor | fornecedor |
| domain | dominio | domínio |
| your own domain | tu propio dominio | seu próprio domínio |
| store address | dirección de la tienda | endereço da loja |
| Discover (the page of shared sites) | Descubrir | Descobrir |
| change (an edit to the store) | cambio | alteração |

### Publishing

| English | Español | Português |
| --- | --- | --- |
| Go live | Publicar | Publicar |
| publish | publicar | publicar |
| Live (badge on a draft, qualifying "borrador"/"rascunho") | Publicado | No ar |
| live (status of a store, qualifying "tienda"/"loja") | publicada | no ar |
| unpublished changes | cambios sin publicar | alterações não publicadas |
| take offline | despublicar | tirar do ar |
| make private | hacer privado | tornar privado |
| bring in live changes | traer los cambios publicados | trazer as alterações publicadas |

### The AI and the chat

| English | Español | Português |
| --- | --- | --- |
| chat | chat | chat |
| AI | IA | IA |
| AI credits | créditos de IA | créditos de IA |
| extra credits | créditos adicionales | créditos extras |
| monthly credits | créditos mensuales | créditos mensais |
| assistant | asistente | assistente |
| message | mensaje | mensagem |
| build (the AI making the store) | crear | criar |
| model (the AI model) | modelo | modelo |
| thinking | pensando | pensando |

### Plans and billing

| English | Español | Português |
| --- | --- | --- |
| plan | plan | plano |
| renew | renovar | renovar |
| billing | facturación | cobrança |
| subscription | suscripción | assinatura |
| card | tarjeta | cartão |
| invoice | factura | fatura |
| receipt | recibo | recibo |
| payment | pago | pagamento |
| price | precio | preço |
| free | gratis | grátis |
| fee | comisión | taxa |
| a month | al mes | por mês |
| monthly | mensual | mensal |
| upgrade (to a higher plan) | mejorar el plan | fazer upgrade |
| downgrade (to a lower plan) | cambiar a un plan inferior | fazer downgrade |
| cancel (a subscription) | cancelar | cancelar |

### Selling and orders

| English | Español | Português |
| --- | --- | --- |
| seller | vendedor | vendedor |
| seller level | nivel de vendedor | nível de vendedor |
| shopper (who buys from a store) | comprador | comprador |
| order | pedido | pedido |
| refund | reembolso | reembolso |
| dispute | disputa | disputa |
| payout | transferencia | repasse |
| payments (the setup page) | pagos | pagamentos |
| checkout (the step where a shopper pays) | Finalizar compra | Finalizar compra |
| cart | carrito | carrinho |
| shipping | envío | envio |
| tracking number | número de seguimiento | código de rastreamento |
| carrier | transportista | transportadora |
| your share | tu parte | sua parte |

### Statuses

Listed in the masculine singular, because the things they label most often (pedido/pedido, pago/pagamento, reembolso/reembolso, borrador/rascunho) are masculine. Make them agree with the noun they qualify: "tienda publicada", "factura pagada", "domínio ativo", "alterações aprovadas".

| English | Español | Português |
| --- | --- | --- |
| pending | pendiente | pendente |
| paid | pagado | pago |
| failed | fallido | falhou |
| shipped | enviado | enviado |
| delivered | entregado | entregue |
| refunded | reembolsado | reembolsado |
| approved | aprobado | aprovado |
| rejected (a review or listing) | rechazado | rejeitado |
| declined (a card payment) | rechazado | recusado |
| active | activo | ativo |
| canceled | cancelado | cancelado |

### Account and navigation

| English | Español | Português |
| --- | --- | --- |
| sign in | iniciar sesión | entrar |
| sign up | crear cuenta | criar conta |
| sign out | cerrar sesión | sair |
| account | cuenta | conta |
| profile | perfil | perfil |
| settings | configuración | configurações |
| language | idioma | idioma |
| password | contraseña | senha |
| email | correo electrónico | e-mail |
| home | inicio | início |
| API key | clave de API | chave de API |

### Common actions and states

| English | Español | Português |
| --- | --- | --- |
| save | guardar | salvar |
| cancel | cancelar | cancelar |
| delete | eliminar | excluir |
| remove | quitar | remover |
| edit | editar | editar |
| close | cerrar | fechar |
| copy | copiar | copiar |
| continue | continuar | continuar |
| back | volver | voltar |
| next | siguiente | próximo |
| search | buscar | pesquisar |
| confirm | confirmar | confirmar |
| send (a message or an email) | enviar | enviar |
| submit (a form, or something for review) | enviar | enviar |
| yes | sí | sim |
| no | no | não |
| done (the button that closes a dialog) | listo | concluir |
| share | compartir | compartilhar |
| connect | conectar | conectar |
| set up | configurar | configurar |
| upload | subir | fazer upload |
| download | descargar | baixar |
| try again | intentar de nuevo | tentar novamente |
| loading | cargando | carregando |
| error | error | erro |

## Where the two languages differ on purpose

- **Template.** Portuguese keeps "template" because "modelo" is the AI model. Spanish uses "plantilla" and "modelo" for the two, with no clash.
- **Billing.** Portuguese uses "cobrança", never "faturamento" (in Brazil that means a company's revenue). Spanish uses "facturación" for Estori's own billing and invoices only.
- **Invoice.** Portuguese "fatura" is the invoice Estori sends. Never "nota fiscal", which is a tax document Estori doesn't issue.
- **Refund.** Both use "reembolso". Portuguese "estorno" means reversing a charge and isn't used.
- **Payout.** Spanish "transferencia" and Portuguese "repasse" are the money Estori pays out to the seller. "Pago" and "pagamento" are what a shopper pays.
- **Live.** Spanish says "publicado" or "publicada", agreeing with what it qualifies ("borrador" is masculine, "tienda" is feminine), and "despublicar". Portuguese says "no ar" and "tirar do ar", which never change. Both use "publicar" for the action itself.
- **Checkout.** Both say "Finalizar compra" for the step where a shopper pays. It is never "pago" or "pagamento", which are the money itself (and "Pagos"/"Pagamentos" is the seller's payments setup page). In running text, write around it: "al finalizar la compra", "ao finalizar a compra".
- **Upload and send.** Portuguese upload is "fazer upload", so "enviar" means send and submit only. "carregar" isn't used for upload because it is already "carregando" (loading). Spanish keeps "subir" for upload and "enviar" for send and submit. "Shipped" is "enviado" in both languages, matching "envío" and "envio".
- **Rejected and declined.** Portuguese tells them apart: "rejeitado" for a review, "recusado" for a card. Spanish uses "rechazado" for both.
- **Shopper.** Always "comprador", never "cliente": Estori's own customers are the sellers, and "cliente" would blur the two.

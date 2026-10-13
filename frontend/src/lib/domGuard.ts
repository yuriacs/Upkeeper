/*
 * Proteção contra extensões e tradutores que mexem no HTML por baixo do React (o tradutor do
 * Chrome troca os textos por <font>…</font>). Quando o React tenta tirar ou pôr um nó que já não
 * está onde ele esperava, o navegador lança um erro e a página fica em branco. Aqui o erro vira
 * só um aviso no console e o React segue (contorno conhecido: facebook/react#11538).
 */
export function guardDomMutations() {
  if (typeof Node !== 'function' || !Node.prototype) return
  const removeChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      console.warn('[dom] removeChild de um nó que já não é filho deste (tradutor/extensão?)')
      return child
    }
    return removeChild.call(this, child) as T
  }
  const insertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      console.warn('[dom] insertBefore com referência que já não é filha deste (tradutor/extensão?)')
      return this.appendChild(node) as T
    }
    return insertBefore.call(this, node, ref) as T
  }
}

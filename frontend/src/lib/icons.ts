/*
 * Ícones próprios no mesmo estilo dos do lucide (traço de 2 px, 24×24), para o que o pacote não tem.
 */
import { createLucideIcon } from 'lucide-react'

/** Lápide: o cemitério (a lixeira dava a ideia de apagar a carta) */
export const Tombstone = createLucideIcon('tombstone', [
  ['path', { d: 'M6 20V10a6 6 0 0 1 12 0v10', key: 'stone' }],
  ['path', { d: 'M3 20h18', key: 'ground' }],
  ['path', { d: 'M12 7.5v7', key: 'cross-v' }],
  ['path', { d: 'M9.5 10h5', key: 'cross-h' }],
])

/** "Okaun // Okaun" (mesmo nome dos dois lados, comum em Secret Lair) vira só "Okaun". */
export function displayName(name: string): string {
  const faces = name.split(' // ')
  return faces.every((f) => f === faces[0]) ? faces[0] : name
}

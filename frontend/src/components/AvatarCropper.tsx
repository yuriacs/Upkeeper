import { useT } from '../lib/i18n'
import ImageCropper from './ImageCropper'

/**
 * Antes de enviar a foto de perfil: o editor de recorte com um quadrado e o círculo de como ela fica
 * na mesa. Sai um quadrado de 512 px; o servidor só confere e reduz.
 */
export default function AvatarCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File
  onCancel: () => void
  onConfirm: (photo: File) => void
}) {
  const t = useT()
  return (
    <ImageCropper
      file={file}
      aspect={1}
      out={[512, 512]}
      round
      title={t('Adjust your photo')}
      help={t('Drag to choose the part that shows and zoom in or out. The circle is how it looks at the table.')}
      confirmLabel={t('Use this photo')}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}

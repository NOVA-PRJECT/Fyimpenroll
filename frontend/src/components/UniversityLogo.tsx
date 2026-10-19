import Image, { type ImageProps } from 'next/image'
import universityLogo from '../../public/knrunilogo.png'

type UniversityLogoProps = Omit<ImageProps, 'src' | 'unoptimized'>

/** Bundle the shared logo as a versioned static asset, independent of sessions. */
export default function UniversityLogo(props: UniversityLogoProps) {
  return <Image {...props} src={universityLogo} unoptimized />
}

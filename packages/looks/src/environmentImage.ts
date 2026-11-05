import { decodeRadianceHdr, type RadianceImage } from '@modelshot/formats';
import { environmentImageBytes } from './environmentImages';

const decoded = new Map<string, RadianceImage>();

/** The bundled image `id`, decoded once (`decodeRadianceHdr` under the default limits). */
export function environmentImage(id: string): RadianceImage {
  let image = decoded.get(id);
  if (!image) {
    image = decodeRadianceHdr(environmentImageBytes(id));
    decoded.set(id, image);
  }
  return image;
}

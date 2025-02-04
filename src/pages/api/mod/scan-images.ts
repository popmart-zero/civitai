import { NextApiRequest, NextApiResponse } from 'next';
import { dbWrite } from '~/server/db/client';
import { z } from 'zod';
import { ModEndpoint } from '~/server/utils/endpoint-helpers';
import { Prisma } from '@prisma/client';
import { env } from '~/env/server.mjs';
import { getEdgeUrl } from '~/components/EdgeImage/EdgeImage';

const stringToNumberArraySchema = z
  .string()
  .transform((s) => s.split(',').map(Number))
  .optional();
const importSchema = z.object({
  imageCount: z.preprocess((x) => (x ? parseInt(String(x)) : undefined), z.number()).optional(),
  imageIds: stringToNumberArraySchema,
  wait: z.preprocess((val) => val === true || val === 'true', z.boolean()).optional(),
});

export default ModEndpoint(
  async function scanImages(req: NextApiRequest, res: NextApiResponse) {
    if (!env.IMAGE_SCANNING_ENDPOINT)
      return res.status(400).json({ error: 'Image scanning is not enabled' });

    const { imageCount, imageIds, wait } = importSchema.parse(req.query);

    const where: Prisma.Enumerable<Prisma.ImageWhereInput> = {};
    if (!!imageIds?.length) where.id = { in: imageIds };
    else if (!!imageCount) where.scanRequestedAt = null;
    else {
      return res.status(400).json({
        error: 'Must provide at least one of imageCount or imageIds',
      });
    }

    const images = await dbWrite.image.findMany({
      where,
      take: imageCount,
      select: { url: true, id: true, width: true, name: true },
    });

    if (!wait) res.status(200).json({ images: images.length });
    else {
      for (const image of images) {
        const width = Math.min(450, image.width ?? 450);
        const anim = image.name?.endsWith('.gif') ? false : undefined;
        const gamma = anim === false ? 0.99 : undefined;
        const url = getEdgeUrl(image.url, { width, anim, gamma });

        await fetch(env.IMAGE_SCANNING_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, imageId: image.id }),
        });
      }

      res.status(200).json({ images: images.length });
    }
  },
  ['GET']
);

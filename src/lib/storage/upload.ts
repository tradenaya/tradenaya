import cloudinary from "./cloudinary";

interface UploadImageProps {
  file: Buffer;
  tenantSlug: string;
  module: string;
  category: string;
  fileName: string;
}

export async function uploadImage({
  file,
  tenantSlug,
  module,
  category,
  fileName,
}: UploadImageProps): Promise<string> {

  const folder =
    `tradenaya/${tenantSlug}/${module}/${category}`;

  return new Promise<string>(
    (
      resolve,
      reject
    ) => {

      const stream =
        cloudinary.uploader.upload_stream(

          {
            folder,
            public_id: fileName,
            resource_type: "image",
            overwrite: false,
          },

          (
            error,
            result
          ) => {

            if (
              error ||
              !result
            ) {

              reject(error);
              return;

            }

            resolve(
              result.secure_url
            );

          }

        );

      stream.end(file);

    }
  );

}
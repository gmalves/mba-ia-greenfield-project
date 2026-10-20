import { ArrayNotEmpty, IsArray, IsInt, Min } from 'class-validator';

export class UploadPartsDto {
  /** Part numbers (1-based) to sign with a presigned PUT URL. */
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  part_numbers: number[];
}

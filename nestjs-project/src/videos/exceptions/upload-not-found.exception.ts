import { DomainException } from '../../common/exceptions/domain.exception';

export class UploadNotFoundException extends DomainException {
  constructor() {
    super('UPLOAD_NOT_FOUND', 404, 'Video or upload session not found');
  }
}

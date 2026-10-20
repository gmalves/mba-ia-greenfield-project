import { DomainException } from '../../common/exceptions/domain.exception';

export class InvalidUploadStateException extends DomainException {
  constructor() {
    super('INVALID_UPLOAD_STATE', 409, 'Video is not in the UPLOADING state');
  }
}

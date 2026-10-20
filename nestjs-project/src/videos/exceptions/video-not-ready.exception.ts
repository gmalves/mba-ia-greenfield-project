import { DomainException } from '../../common/exceptions/domain.exception';

export class VideoNotReadyException extends DomainException {
  constructor() {
    super('VIDEO_NOT_READY', 409, 'Video is not ready for streaming');
  }
}

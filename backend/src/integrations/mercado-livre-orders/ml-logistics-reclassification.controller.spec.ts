import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessTokenGuard } from '../../auth/guards/access-token.guard';
import { MlLogisticsReclassificationController } from './ml-logistics-reclassification.controller';
import { MlLogisticsReclassificationError } from './ml-logistics-reclassification.service';

function buildController(service: Record<string, jest.Mock>) {
  return new MlLogisticsReclassificationController(service as never);
}

describe('MlLogisticsReclassificationController', () => {
  it('requires AccessTokenGuard at the class level (endpoint protegido)', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      MlLogisticsReclassificationController,
    ) as unknown[];
    expect(guards).toContain(AccessTokenGuard);
  });

  describe('rotas por conta', () => {
    it('status delegates to service.getStatus with the validated accountId', async () => {
      const service = {
        getStatus: jest.fn().mockResolvedValue({ status: 'IDLE' }),
      };
      const controller = buildController(service);
      const result = await controller.status('acc-1');
      expect(service.getStatus).toHaveBeenCalledWith('acc-1');
      expect(result).toEqual({ status: 'IDLE' });
    });

    it('start delegates to service.start', async () => {
      const service = {
        start: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
      };
      const controller = buildController(service);
      await controller.start('acc-1');
      expect(service.start).toHaveBeenCalledWith('acc-1');
    });

    it('pause delegates to service.pause', async () => {
      const service = {
        pause: jest.fn().mockResolvedValue({ status: 'PAUSED' }),
      };
      const controller = buildController(service);
      await controller.pause('acc-1');
      expect(service.pause).toHaveBeenCalledWith('acc-1');
    });

    it('resume delegates to service.resume', async () => {
      const service = {
        resume: jest.fn().mockResolvedValue({ status: 'RUNNING' }),
      };
      const controller = buildController(service);
      await controller.resume('acc-1');
      expect(service.resume).toHaveBeenCalledWith('acc-1');
    });

    it('maps MlLogisticsReclassificationError (wrong marketplace) to BadRequestException — never leaks accountId of another marketplace silently', async () => {
      const service = {
        getStatus: jest
          .fn()
          .mockRejectedValue(
            new MlLogisticsReclassificationError('ACCOUNT_NOT_MERCADO_LIVRE'),
          ),
      };
      const controller = buildController(service);
      await expect(controller.status('shopee-acc')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('propagates any other error unchanged (e.g. NotFoundException from findByIdOrFail)', async () => {
      class FakeNotFound extends Error {}
      const service = {
        getStatus: jest.fn().mockRejectedValue(new FakeNotFound('nope')),
      };
      const controller = buildController(service);
      await expect(controller.status('missing')).rejects.toBeInstanceOf(
        FakeNotFound,
      );
    });
  });

  describe('rotas "todas as contas"', () => {
    it('statusAll delegates to service.getStatusForAllAccounts', async () => {
      const service = {
        getStatusForAllAccounts: jest.fn().mockResolvedValue([]),
      };
      const controller = buildController(service);
      await controller.statusAll();
      expect(service.getStatusForAllAccounts).toHaveBeenCalledTimes(1);
    });

    it('startAll delegates to service.startAll', async () => {
      const service = { startAll: jest.fn().mockResolvedValue([]) };
      const controller = buildController(service);
      await controller.startAll();
      expect(service.startAll).toHaveBeenCalledTimes(1);
    });

    it('pauseAll delegates to service.pauseAll', async () => {
      const service = { pauseAll: jest.fn().mockResolvedValue([]) };
      const controller = buildController(service);
      await controller.pauseAll();
      expect(service.pauseAll).toHaveBeenCalledTimes(1);
    });

    it('resumeAll delegates to service.resumeAll', async () => {
      const service = { resumeAll: jest.fn().mockResolvedValue([]) };
      const controller = buildController(service);
      await controller.resumeAll();
      expect(service.resumeAll).toHaveBeenCalledTimes(1);
    });
  });
});

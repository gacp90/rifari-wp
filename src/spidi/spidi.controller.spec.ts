import { Test, TestingModule } from '@nestjs/testing';
import { SpidiController } from './spidi.controller';
import { SpidiService } from './spidi.service';

describe('SpidiController', () => {
  let controller: SpidiController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SpidiController],
      providers: [SpidiService],
    }).compile();

    controller = module.get<SpidiController>(SpidiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

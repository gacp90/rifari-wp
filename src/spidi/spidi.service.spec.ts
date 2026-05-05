import { Test, TestingModule } from '@nestjs/testing';
import { SpidiService } from './spidi.service';

describe('SpidiService', () => {
  let service: SpidiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SpidiService],
    }).compile();

    service = module.get<SpidiService>(SpidiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

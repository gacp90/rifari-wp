import { Module } from '@nestjs/common';
import { MetaService } from './meta.service';
import { MetaController } from './meta.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [MetaService],
  controllers: [MetaController],
  exports: [MetaService]
})
export class MetaModule {}

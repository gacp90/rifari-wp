import { PartialType } from '@nestjs/mapped-types';
import { CreateSpidiDto } from './create-spidi.dto';

export class UpdateSpidiDto extends PartialType(CreateSpidiDto) {}

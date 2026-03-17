import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*', // En producción pon aquí la URL de tu Angular (ej: 'http://localhost:4200')
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, x-api-key', // Asegúrate de incluir tu header personalizado
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();

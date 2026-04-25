import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { TimeOffDomainExceptionFilter } from './presentation/filters/TimeOffDomainExceptionFilter';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DI_TOKENS } from './infrastructure/di/InjectionTokens';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new TimeOffDomainExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('Time-Off Microservice')
    .setDescription('Microservice for managing employee time-off requests')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.init(); 

  const dbConnection = app.get<BetterSQLite3Database>(DI_TOKENS.DB_CONNECTION);
  migrate(dbConnection, { migrationsFolder: './drizzle' });
  console.log('Database schemas successfully synchronized.');

  await app.listen(process.env.PORT || 3000);
  console.log(`Application is running on port: ${process.env.PORT || 3000}`);
}

bootstrap().catch((err) => {
  console.error('Error during bootstrap', err);
  process.exit(1);
});
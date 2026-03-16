import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
} from '@nestjs/common';
import { ZodError } from 'zod';

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = 400;

    const details = exception.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    response.status(status).send(
      new BadRequestException({
        message: 'Validation failed',
        details,
      }).getResponse(),
    );
  }
}

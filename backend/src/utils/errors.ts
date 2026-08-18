export class NotFoundError extends Error {
code = 'NOT_FOUND';
constructor(message?: string) {
super(message || 'Resource not found');
this.name = 'NotFoundError';
}
}

export class ValidationError extends Error {
code = 'VALIDATION';
constructor(message?: string) {
super(message || 'Validation failed');
this.name = 'ValidationError';
}
}

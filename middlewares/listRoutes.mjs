//middlewares/listRoutes.mjs
import swaggerJsdoc from 'swagger-jsdoc';

const swaggerOptions = {
  swaggerDefinition: {
    openapi: '3.0.0',
    info: {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'API documentation with Swagger',
    },
  },
  apis: ['./routes/*.js'], // Caminho para os arquivos das rotas
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);

export default (app) => {
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      console.log(`${Object.keys(middleware.route.methods)[0].toUpperCase()} ${middleware.route.path}`);
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          console.log(`${Object.keys(handler.route.methods)[0].toUpperCase()} ${handler.route.path}`);
        }
      });
    }
  });

  // Imprime detalhes das rotas a partir do Swagger
  const paths = swaggerDocs.paths;
  for (const path in paths) {
    for (const method in paths[path]) {
      const route = paths[path][method];
      console.log(`\n${method.toUpperCase()} ${path}`);
      console.log(`Summary: ${route.summary}`);
      console.log(`Parameters:`);
      if (route.parameters) {
        route.parameters.forEach((param) => {
          console.log(`- ${param.name} (${param.in}): ${param.description}`);
        });
      } else {
        console.log(`- None`);
      }
      console.log(`Request Body:`);
      if (route.requestBody) {
        const requestBody = route.requestBody.content['application/json'].schema;
        console.log(JSON.stringify(requestBody, null, 2));
      } else {
        console.log(`- None`);
      }
      console.log(`Responses:`);
      for (const response in route.responses) {
        console.log(`${response}: ${route.responses[response].description}`);
        if (route.responses[response].content) {
          const responseBody = route.responses[response].content['application/json'].schema;
          console.log(JSON.stringify(responseBody, null, 2));
        }
      }
    }
  }
};
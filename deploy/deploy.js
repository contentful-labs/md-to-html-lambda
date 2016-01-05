import {readFileSync} from 'fs'

import {Lambda, APIGateway} from 'aws-sdk'
import hat from 'hat'

async function main ({
  region,
  accountId,
  lambdaRole,
  apiName,
  lambdaName
}) {
  const apiGateway = new APIGateway({region})

  // API Gateway APIs always have a deployment stage in the path. By setting the
  // deployment stage to 'spaces' we end up with a URL path identical to the
  // Contentful Delivery API: /spaces/{spaceId}/entries
  const deploymentStage = 'spaces'
  const resourcePath = '/{spaceId}/entries'

  const lambdaArn = await createOrUpdateLambda(
    region,
    lambdaRole,
    lambdaName,
    readFileSync(__dirname + '/../lambda.zip')
  )

  console.log('Created lambda function', lambdaName)

  const restApi = await getOrCreateRestApi(apiGateway, apiName)

  console.log('Created API', apiName)

  const resource = await getOrCreateResourceAtPath(apiGateway, restApi.id, resourcePath)

  console.log('Created Resource', resource)

  try {
    await p(cb => apiGateway.deleteMethod({
      httpMethod: 'GET',
      resourceId: resource.id,
      restApiId: restApi.id
    }, cb))
  } catch (_) {
  }

  const method = await p(cb => apiGateway.putMethod({
    authorizationType: "NONE",
    httpMethod: 'GET',
    apiKeyRequired: false,
    resourceId: resource.id,
    restApiId: restApi.id,
    requestParameters: {
      'method.request.header.Authorization': false,
      'method.request.path.spaceId': false,
    }
  }, cb))

  console.log('Created Method GET', resource.path)

  const response = await p(cb => apiGateway.putMethodResponse({
    httpMethod: 'GET',
    resourceId: resource.id,
    restApiId: restApi.id,
    statusCode: '200',
    responseModels: {},
    responseParameters: {
      'method.response.header.Access-Control-Allow-Origin': false
    }
  }, cb))

  await p(cb => apiGateway.putIntegration({
    httpMethod: 'GET',
    resourceId: resource.id,
    restApiId: restApi.id,
    type: 'AWS',
    credentials: null,
    integrationHttpMethod: 'POST',  // <-- Lambdas **always** take a POST
    requestParameters: {},
    requestTemplates: {
      'application/json': `{
        "spaceId": "$input.params('spaceId')",
        "query": "$input.params().querystring",
        "authorization": "$input.params('Authorization')"
      }`
    },
    uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`
  }, cb))

  await p(cb => apiGateway.putIntegrationResponse({
    httpMethod: 'GET',
    restApiId: restApi.id,
    resourceId: resource.id,
    selectionPattern: null,
    statusCode: '200',
    responseTemplates: { 'application~1json': '' },
    responseParameters: {
      'method.response.header.Access-Control-Allow-Origin': "'*'"
    }
  }, cb))

  const methodArn = [
    'arn:aws:execute-api', 
    region,
    accountId,
    restApi.id + '/*/GET' + resource.path.replace(/\{[^\/\}]+\}/g, '*')
  ].join(':')

  console.log(`Granting invoke permission to ${methodArn}`)
  await grantInvokePermission(lambdaArn, methodArn)

  const deployment = await p(cb => apiGateway.createDeployment({
    restApiId: restApi.id,
    stageName: deploymentStage
  }, cb))

  console.log(`Deployed https://${restApi.id}.execute-api.${region}.amazonaws.com/${deploymentStage}${resourcePath}`)
}

async function getOrCreateRestApi (apiGateway, name) {
  const apis = (await p(cb => apiGateway.getRestApis({}, cb))).items.filter(api => api.name == name)
  if (apis.length == 0) {
    return p(cb => apiGateway.createRestApi({name}, cb))
  } else {
    return apis[0]
  }
}

async function getOrCreateResourceAtPath (apiGateway, restApiId, path) {
  const pathParts = path.split('/').slice(1)

  const existingResources = (
    await p(cb => apiGateway.getResources({restApiId}, cb))
  ).items.reduce(
    (map, resource) => map.set(resource.path, resource),
    new Map()
  )

  for (let i = 0, len = pathParts.length; i < len; i++) {
    let pathPart = pathParts[i]
    let subPath = '/' + pathParts.slice(0, i + 1).join('/')
    let parentPath = '/' + pathParts.slice(0, i).join('/')

    let parentResource = existingResources.get(parentPath)
    let existingResource = existingResources.get(subPath)

    if (!(parentResource && parentResource.id)) {
      throw new Error(`Parent Resource ${parentPath} must be created before ${subPath}`)
    }

    if (!existingResource) {
      let newResource = await p(cb => apiGateway.createResource({
        pathPart,
        restApiId,
        parentId: parentResource.id,
      }, cb))
      existingResources.set(newResource.path, newResource)
    }
  }

  return existingResources.get(path)
}

async function createOrUpdateLambda (region, Role, FunctionName, ZipFile) {

  const lambda = new Lambda({region})

  try {
    const {FunctionArn} = await p(cb => lambda.updateFunctionCode({ FunctionName, ZipFile }, cb))
    return FunctionArn
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err
    }
    const {FunctionArn} = await p(cb => lambda.createFunction({
      FunctionName,
      Role,
      Runtime: "nodejs",
      Handler: 'index.handler',
      Code: { ZipFile }
    }, cb))
    return FunctionArn
  }
}

async function grantInvokePermission (FunctionName, SourceArn) {
  const [,,,region] = SourceArn.split(':')
  const lambda = new Lambda({region})

  function grantsExpectedPermission ({Condition, Action, Resource, Effect, Principal}) {
    return (
      Condition && Condition.ArnLike && Condition.ArnLike['AWS:SourceArn'] === SourceArn &&
      Principal && Principal.Service === 'apigateway.amazonaws.com' &&
      Action === 'lambda:InvokeFunction' &&
      Effect === 'Allow'
    )
  }

  try {
    const {Policy} = await p(cb => lambda.getPolicy({FunctionName}, cb))
    const {Statement} = JSON.parse(Policy)

    if (Statement.some(grantsExpectedPermission)) {
      return;
    }
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err;
    }
  }

  const params = {
    FunctionName,
    SourceArn,
    StatementId: hat(),
    Action: 'lambda:InvokeFunction',
    Principal: 'apigateway.amazonaws.com',
  }

  return p(cb => lambda.addPermission(params, cb))
}

function p (fn) {
  return new Promise((resolve, reject) => fn(
    (err, result) => err ? reject(err) : resolve(result)
  ))
}

if (!module.parent) {
  main(require('./config')).catch(e => {
    console.error(e.stack)
    process.exit(1)
  })
}

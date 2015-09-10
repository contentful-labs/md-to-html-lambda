import {readFileSync} from 'fs'

import {Lambda} from 'aws-sdk'
import getOrCreateApi from 'api-gateway-tools'
import hat from 'hat'

async function main ({
  region,
  accountId,
  lambdaRole,
  apiName,
  lambdaName
}) {
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

  const api = await getOrCreateApi(region, apiName)

  console.log('Created API', apiName)

  const resource = await api.getOrCreateResource(resourcePath)

  console.log('Created Resource', resourcePath)

  const method = await resource.updateMethod('GET', {
    httpMethod: 'GET',
    apiKeyRequired: false,
    authorizationType: "NONE",
    requestParameters: {
      'method.request.header.Authorization': false,
      'method.request.path.spaceId': false,
    }
  })

  console.log('Created Method GET', resourcePath)

  const response = await method.updateResponse(200, {
    modelNames: {},
    responseParameters: {
      'method.response.header.Access-Control-Allow-Origin': false
    }
  })

  await method.updateIntegration({
    type: 'AWS',
    httpMethod: 'POST',  // <-- Lambdas **always** take a POST
    uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaArn}/invocations`,
    credentials: null,
    requestTemplates: {
      'application/json': `{
        "spaceId": "$input.params('spaceId')",
        "query": "$input.params().querystring",
        "authorization": "$input.params('Authorization')"
      }`
    }
  })

  await method.updateIntegrationResponse(200, {
    selectionPattern: null,
    responseTemplates: { 'application~1json': '' },
    responseParameters: {
      'method.response.header.Access-Control-Allow-Origin': "'*'"
    }
  })

  const methodArn = method.arn(region, accountId, '*')
  console.log(`Granting invoke permission to ${methodArn}`)
  await grantInvokePermission(lambdaArn, methodArn)

  await api.createDeployment(deploymentStage)
  console.log(`Deployed https://${api.id}.execute-api.${region}.amazonaws.com/${deploymentStage}${resourcePath}`)
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

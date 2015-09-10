var querystring = require('querystring')

var createTransform = require('contentful-resource-transform')
var fetch = require('node-fetch')
var Promise = fetch.Promise = require('es6-promise').Promise
var marked = require('marked')

/**
 * This transformer function will walk over a Contentful response object
 * and transform every entry by rendering it's Text fields to HTML.
 *
 * The `textFields` object is created by `initTextFields`
 */
var mdToHtml = createTransform({
  Entry: function (entry, textFields) {
    var fieldIds = textFields[entry.sys.contentType.sys.id]
    fieldIds.forEach(function (fieldId) {
      entry.fields[fieldId] = marked(entry.fields[fieldId] || '')
    })
    return entry
  }
})

/**
 * helper function for making authenticated Delivery API requests
 */
function get (spaceId, accessToken, resourcePath, params) {
  var url = 'https://cdn.contentful.com/spaces/' + spaceId + '/' + resourcePath
  if (params) {
    url += '?' + querystring.stringify(params)
  }
  var headers = { Authorization: 'Bearer ' + accessToken }
  return fetch(url, { headers:  headers }).then(function (response) {
    return response.json()
  }).then(function (data) {
    if (data.sys.type === 'Error') {
      throw new Error(data.message);
    }
    return data;
  })
}

/**
 * Given a space id and access token, return a promise for a lookup table that
 * maps from a content type id to an array of Text field id's.
 */
function initTextFields (spaceId, accessToken) {
  return get(spaceId, accessToken, 'content_types').then(function (array) {
    return array.items.reduce(function (lookup, contentType) {
      lookup[contentType.sys.id] = contentType.fields.filter(function (field) {
        return field.type === 'Text'
      }).map(function (field) {
        return field.id
      })
      return lookup
    }, {})
  })
}

/**
 * Because content types in a space rarely change, it's redundant (and slow) to
 * constantly re-request them in `initTextFields`. Instead we use a simple
 * in-memory cache that expires every 30 seconds. A more robust implementation
 * might use an external cache expired by a webhook.
 */
var TEXT_FIELDS = {}

function getTextFields (spaceId, accessToken) {
  var key = spaceId + '!' + accessToken
  if (!TEXT_FIELDS.hasOwnProperty(key)) {
    TEXT_FIELDS[key] = initTextFields(spaceId, accessToken)
    setTimeout(function () { delete TEXT_FIELDS[key] }, 30 * 1000)
  }
  return TEXT_FIELDS[key]
}

function parseQuery (string) {
  string = string.substr(1, string.length - 2)
  return querystring.parse(string.replace(/, /g, '&'))
}

/**
 * The handler function that Lambda will call to handle web requests.
 */
exports.handler = function (event, context) {
  try {
    var spaceId = event.spaceId
    var query = parseQuery(event.query)
    var accessToken = event.authorization
      ? event.authorization.replace(/^Bearer /, '')
      : query.access_token

    getTextFields(spaceId, accessToken).then(function (textFields) {
      return get(spaceId, accessToken, 'entries', query).then(function (array) {
        return mdToHtml(array, textFields)
      })
    }).then(context.succeed, function (error) {
      if (typeof error === 'object' && !(error instanceof Error)) {
        error = new Error(error.message)
      }
      context.fail(error)
    })
  } catch (error) {
    context.fail(error)
  }
}

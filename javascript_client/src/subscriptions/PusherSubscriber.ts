import registry from "./registry"
import { Pusher } from "pusher-js"

interface ApolloNetworkInterface {
  use: Function
  useAfter: Function
  query: (req: object) => Promise<any>
}
/**
 * Make a new subscriber for `addGraphQLSubscriptions`
 *
 * @param {Pusher} pusher
*/

class PusherSubscriber {
  _pusher: Pusher
  _networkInterface: ApolloNetworkInterface

  constructor(pusher: Pusher, networkInterface: ApolloNetworkInterface) {
    this._pusher = pusher
    this._networkInterface = networkInterface
    // This is a bit tricky:
    // only the _request_ is passed to the `subscribe` function, s
    // so we have to attach the subscription id to the `request`.
    // However, the request is _not_ available in the afterware function.
    // So:
    // - Add the request to `options` so it's available in afterware
    // - In the afterware, update the request to hold the header value
    // - Finally, in `subscribe`, read the subscription ID off of `request`
    networkInterface.use([{
      applyMiddleware: function({request, options}: any, next: Function) {
        options.request = request
        next()
      }
    }])
    networkInterface.useAfter([{
      applyAfterware: function({response, options}: any, next: Function) {
        options.request.__subscriptionId = response.headers.get("X-Subscription-ID")
        next()
      }
    }])
  }
  // Implement the Apollo subscribe API
  subscribe(request: {__subscriptionId: string}, handler: any) {
    var pusher = this._pusher
    var networkInterface = this._networkInterface
    var subscription = {
      _channelName: "", // set after the successful POST
      unsubscribe: function() {
        if (this._channelName) {
          pusher.unsubscribe(this._channelName)
        }
      }
    }
    var id = registry.add(subscription)
    // Send the subscription as a query
    // Get the channel ID from the response headers
    networkInterface.query(request).then(function(_executionResult: any){
      var subscriptionChannel = request.__subscriptionId
      subscription._channelName = subscriptionChannel
      var pusherChannel = pusher.subscribe(subscriptionChannel)
      // When you get an update form Pusher, send it to Apollo
      pusherChannel.bind("update", function(payload) {
        if (!payload.more) {
          registry.unsubscribe(id)
        }
        var result = payload.result
        if (result) {
          handler(result.errors, result.data)
        }
      })
    })
    return id
  }

  unsubscribe(id: number) {
    registry.unsubscribe(id)
  }
}
export default PusherSubscriber
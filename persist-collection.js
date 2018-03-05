import localforage from 'localforage'
import { extendPrototype as extendGetItems } from 'localforage-getitems'
import { extendPrototype as extendSetItems } from 'localforage-setitems'
import { LocalCollection } from 'meteor/minimongo'

extendGetItems(localforage)
extendSetItems(localforage)

const driver = (names) => names.map(name => localforage[name.toUpperCase()])

export default class PersistedCollection extends Mongo.Collection {

  constructor(name, options) {
    super(name, options)
    this._driver = options.driver &&
                   driver(options.driver) ||
                   ['WEBSQL','INDEXEDDB','LOCALSTORAGE']
    this._isCommon = false
    this._isSyncing = new ReactiveVar(false)
  }

  _createLfInstance(col = {}) {
    return localforage.createInstance({
      driver: this._driver,
      name: 'persisted_collections',
      storeName: col._name || this._name
    })
  }

  isCommon(bool) {

    this._isCommon = bool || true
  }

  isSyncing() {

    return this._isSyncing.get()
  }

  setPersisted(data) {

    const store = this._createLfInstance()

    return store.setItems(data)
  }

  getPersisted(ids) {

    const store = this._createLfInstance()

    if (_.isString(ids))
      return store.getItem(ids)
    else if (_.isArray(ids) || !ids)
      return store.getItems(ids || null)
    else
      throw new Error('Invalid id(\'s) argument.')
  }

  removePersisted(ids) {

    const store = this._createLfInstance()

    if (_.isString(ids))
      return store.removeItem(ids)
    else if (_.isArray(ids))
      return Promise.all(ids.map(id => store.removeItem(id)))
    else
      throw new Error('Invalid id(\'s) argument.')
  }

  clearPersisted() {

    const store = this._createLfInstance()

    return store.clear()
  }

  syncPersisted() {

    const col = this

    return new Promise((resolve, reject) => {

      col._isSyncing.set(true)

      const store = this._createLfInstance(col)

      const inserted = []
      const updated = []
      const removed = []

      store.getItems().then(pc => {

        for (let key in pc) {

          if (pc.hasOwnProperty(key)) {

            const doc = pc[key]

            if (col._isCommon)
              if (doc === false) {

                removed.push(key)
              } else if (doc._insertedOffline && doc._updatedOffline) {

                delete doc._insertedOffline
                delete doc._updatedOffline

                inserted.push(doc)
              } else if (doc._insertedOffline) {

                delete doc._insertedOffline

                inserted.push(doc)
              } else if (doc._updatedOffline) {

                delete doc._updatedOffline

                updated.push(doc)
              }

            if (doc !== false) {

              doc._id = key

              col._collection._docs.set(key, doc)
            }
          }
        }

        _.each(col._collection.queries, query => {

          col._collection._recomputeResults(query)
        })

        col._isSyncing.set(false)

        resolve({ inserted, updated, removed })
      }).catch(reject)
    })
  }

  detachPersisters(ids) {

    const persisters = this._persisters

    let removeIds = []

    if (_.isString(ids))
      removeIds.push(ids)
    else if (_.isArray(ids))
      removeIds = ids
    else if (ids)
      throw new Error('Invalid id(\'s) argument.')

    if (!ids)
      for (let id in persisters) {

        if (persisters.hasOwnProperty(id)) {

          const persister = persisters[id]

          persister._observeHandle.stop()

          delete this._persisters[id]
        }
      }
    else
      removeIds.forEach(id => {

        const persister = persisters[id]

        persister._observeHandle.stop()

        delete this._persisters[id]
      })
  }

  attachPersister(selector, options) {

    const col = this

    if (!col._persisters)
      col._persisters = {}

    const persisterId = col._collection.next_qid
    const persister = {}

    col._persisters[persisterId] = persister

    persister._store = this._createLfInstance(col)

    persister._observeHandle = col.find(selector || {}, options || {}).observe({
      added (doc) {

        const _id = doc._id
        delete doc._id

        if (!Meteor.status().connected && col._isCommon)
          doc._insertedOffline = true

        persister._store.setItem(_id, doc).catch(console.error)
      },
      changed (doc) {

        const _id = doc._id
        delete doc._id

        if (!Meteor.status().connected && col._isCommon)
          doc._updatedOffline = true

        persister._store.setItem(_id, doc).catch(console.error)
      },
      removed (doc) {

        if (!Meteor.status().connected && col._isCommon)
          persister._store.setItem(doc._id, false).catch(console.error)
        else
          persister._store.removeItem(doc._id).catch(console.error)
      }
    })

    return persisterId
  }
}
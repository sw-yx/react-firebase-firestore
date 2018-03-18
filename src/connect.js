// this is react-firebase.connect adapted for firestore

// import PropTypes from "prop-types";
import React, { Component, createElement } from "react";
import firebase from "firebase/app";
import "firebase/database";
import shallowEqual from "shallowequal";
import {
  createQueryRef,
  getDisplayName,
  mapValues,
  pickBy,
  mapSnapshotToValue
} from "./utils";

const defaultMergeProps = (ownProps, firebaseProps) => ({
  ...ownProps,
  ...firebaseProps
});

const mapSubscriptionsToQueries = subscriptions =>
  mapValues(
    subscriptions,
    value => (typeof value === "string" ? { path: value } : value)
  );

const defaultMapFirebaseToProps = (props, ref, firestore) => ({
  firestore
});

export default (
  mapFirebaseToProps = defaultMapFirebaseToProps,
  mergeProps = defaultMergeProps
) => {
  const mapFirebase = (...args) => {
    if (typeof mapFirebaseToProps !== "function") {
      return mapFirebaseToProps;
    }

    const firebaseProps = mapFirebaseToProps(...args);

    if (firebaseProps === null || typeof firebaseProps !== "object") {
      throw new Error(
        `react-firebase: mapFirebaseToProps must return an object. Instead received ${firebaseProps}.`
      );
    }

    return firebaseProps;
  };

  const computeSubscriptions = (props, ref, firestore) => {
    const firebaseProps = mapFirebase(props, ref, firestore);
    return pickBy(
      firebaseProps,
      prop => typeof prop === "string" || (prop && prop.path)
    );
  };

  return WrappedComponent => {
    class FirebaseConnect extends Component {
      constructor(props, context) {
        super(props, context);
        this.firestore =
          props.firestore || context.firestore || firebase.firestore();

        // polymorph based on number of /'s in path
        this.ref = path =>
          isCollection(path)
            ? this.firestore.collection(path)
            : this.firestore.doc(path);
        this.state = {
          subscriptionsState: null,
          subscribeSuccess: true
        };
      }

      componentDidMount() {
        const subscriptions = computeSubscriptions(
          this.props,
          this.ref,
          this.firestore
        );

        this.mounted = true;
        this.subscribe(subscriptions);
      }

      componentWillReceiveProps(nextProps) {
        const subscriptions = computeSubscriptions(
          this.props,
          this.ref,
          this.firestore
        );
        const nextSubscriptions = computeSubscriptions(
          nextProps,
          this.ref,
          this.firestore
        );
        const addedSubscriptions = pickBy(
          nextSubscriptions,
          (path, key) => !subscriptions[key]
        );
        const removedSubscriptions = pickBy(
          subscriptions,
          (path, key) => !nextSubscriptions[key]
        );
        const changedSubscriptions = pickBy(
          nextSubscriptions,
          (path, key) =>
            subscriptions[key] && !shallowEqual(subscriptions[key], path)
        );

        this.unsubscribe({ ...removedSubscriptions, ...changedSubscriptions });
        this.subscribe({ ...addedSubscriptions, ...changedSubscriptions });
      }

      componentWillUnmount() {
        this.mounted = false;

        if (this.listeners) {
          this.unsubscribe(this.listeners);
        }
      }

      subscribe(subscriptions) {
        if (Object.keys(subscriptions).length < 1) {
          return;
        }

        const queries = mapSubscriptionsToQueries(subscriptions);
        const nextListeners = mapValues(queries, ({ path, ...query }, key) => {
          const containsOrderBy = Object.keys(query).some(queryKey =>
            queryKey.startsWith("orderBy")
          );
          const subscriptionRef = createQueryRef(
            this.ref(path), //.doc(path),
            query
          );
          const update = querySnapshot => {
            if (this.mounted) {
              if (isCollection(path)) {
                // its a collection
                const allstuff = [];
                querySnapshot.forEach(snapshot => {
                  const value = containsOrderBy
                    ? mapSnapshotToValue(snapshot)
                    : snapshot.data();
                  value._id = snapshot.id;
                  allstuff.push(value);
                });
                this.setState(prevState => ({
                  subscriptionsState: {
                    ...prevState.subscriptionsState,
                    [key]: allstuff
                  }
                }));
              } else {
                // its a document
                const value = containsOrderBy
                  ? mapSnapshotToValue(querySnapshot)
                  : querySnapshot.data();

                this.setState(prevState => ({
                  subscriptionsState: {
                    ...prevState.subscriptionsState,
                    [key]: value
                  }
                }));
              }
            }
          };
          let unsubscribe;
          try {
            unsubscribe = subscriptionRef.onSnapshot(update);
          } catch (err) {
            console.log(
              "FirePup: Error occured while querying your Firestore. If this is your first time running this, you might need to enable firestore permissioning. See INSERT_CLEVER_BEAGLE_DOCS_LINK."
            );
            console.error(err);
            this.setState({ subscribeSuccess: false });
          }

          return {
            path,
            unsubscribe: () => unsubscribe()
          };
        });

        this.listeners = { ...this.listeners, ...nextListeners };
      }

      unsubscribe(subscriptions) {
        if (Object.keys(subscriptions).length < 1) {
          return;
        }

        const nextListeners = { ...this.listeners };
        const nextSubscriptionsState = { ...this.state.subscriptionsState };

        Object.keys(subscriptions).forEach(key => {
          const subscription = this.listeners[key];
          subscription.unsubscribe();

          delete nextListeners[key];
          delete nextSubscriptionsState[key];
        });

        this.listeners = nextListeners;
        this.setState({ subscriptionsState: nextSubscriptionsState });
      }

      render() {
        const firebaseProps = mapFirebase(this.props, this.ref, this.firestore);
        const actionProps = pickBy(
          firebaseProps,
          prop => typeof prop === "function"
        );
        const subscriptionProps = this.state.subscriptionsState;
        const props = mergeProps(this.props, {
          ...actionProps,
          ...subscriptionProps
        });

        return this.state.subscribeSuccess ? (
          createElement(WrappedComponent, props)
        ) : (
          <div>
            {" "}
            Failed to load data from Firestore (see console for details).{" "}
          </div>
        );
      }
    }

    FirebaseConnect.WrappedComponent = WrappedComponent;
    FirebaseConnect.defaultProps = Component.defaultProps;
    FirebaseConnect.displayName = `FirebaseConnect(${getDisplayName(
      WrappedComponent
    )})`;
    // FirebaseConnect.contextTypes = FirebaseConnect.propTypes = {
    //   firebaseApp: PropTypes.shape({
    //     database: PropTypes.func.isRequired // eslint-disable-line react/no-unused-prop-types
    //   })
    // };

    return FirebaseConnect;
  };
};

const isCollection = path => path.split("/").filter(x => x).length % 2;

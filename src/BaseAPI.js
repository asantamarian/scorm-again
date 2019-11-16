// @flow
import {CMIArray} from './cmi/common';
import {ValidationError} from './exceptions';
import {scorm12_error_codes} from './constants/error_codes';
import {global_constants} from './constants/api_constants';

/**
 * Base API class for AICC, SCORM 1.2, and SCORM 2004. Should be considered
 * abstract, and never initialized on it's own.
 */
export default class BaseAPI {
  #timeout;
  #error_codes;
  #settings = {
    autocommit: false,
    autocommitSeconds: 60,
    lmsCommitUrl: false,
    dataCommitFormat: 'json', // valid formats are 'json' or 'flattened', 'params'
  };
  cmi;
  startingData: {};

  /**
   * Constructor for Base API class. Sets some shared API fields, as well as
   * sets up options for the API.
   * @param {object} error_codes
   * @param {object} settings
   */
  constructor(error_codes, settings) {
    if (new.target === BaseAPI) {
      throw new TypeError('Cannot construct BaseAPI instances directly');
    }
    this.currentState = global_constants.STATE_NOT_INITIALIZED;
    this.apiLogLevel = global_constants.LOG_LEVEL_ERROR;
    this.lastErrorCode = 0;
    this.listenerArray = [];

    this.#timeout = null;
    this.#error_codes = error_codes;

    this.settings = settings;
  }

  /**
   * Initialize the API
   * @param {string} callbackName
   * @param {string} initializeMessage
   * @param {string} terminationMessage
   * @return {string}
   */
  initialize(
      callbackName: String,
      initializeMessage?: String,
      terminationMessage?: String) {
    let returnValue = global_constants.SCORM_FALSE;

    if (this.isInitialized()) {
      this.throwSCORMError(this.#error_codes.INITIALIZED, initializeMessage);
    } else if (this.isTerminated()) {
      this.throwSCORMError(this.#error_codes.TERMINATED, terminationMessage);
    } else {
      this.currentState = global_constants.STATE_INITIALIZED;
      this.lastErrorCode = 0;
      returnValue = global_constants.SCORM_TRUE;
      this.processListeners(callbackName);
    }

    this.apiLog(callbackName, null, 'returned: ' + returnValue,
        global_constants.LOG_LEVEL_INFO);
    this.clearSCORMError(returnValue);

    return returnValue;
  }

  /**
   * Getter for #settings
   * @return {object}
   */
  get settings() {
    return this.#settings;
  }

  /**
   * Setter for #settings
   * @param {object} settings
   */
  set settings(settings: Object) {
    this.#settings = {...this.#settings, ...settings};
  }

  /**
   * Terminates the current run of the API
   * @param {string} callbackName
   * @param {boolean} checkTerminated
   * @return {string}
   */
  terminate(
      callbackName: String,
      checkTerminated: boolean) {
    let returnValue = global_constants.SCORM_FALSE;

    if (this.checkState(checkTerminated,
        this.#error_codes.TERMINATION_BEFORE_INIT,
        this.#error_codes.MULTIPLE_TERMINATION)) {
      if (checkTerminated) this.lastErrorCode = 0;
      this.currentState = global_constants.STATE_TERMINATED;
      returnValue = global_constants.SCORM_TRUE;
      this.processListeners(callbackName);
    }

    this.apiLog(callbackName, null, 'returned: ' + returnValue,
        global_constants.LOG_LEVEL_INFO);
    this.clearSCORMError(returnValue);

    return returnValue;
  }

  /**
   * Get the value of the CMIElement.
   *
   * @param {string} callbackName
   * @param {boolean} checkTerminated
   * @param {string} CMIElement
   * @return {string}
   */
  getValue(
      callbackName: String,
      checkTerminated: boolean,
      CMIElement: String) {
    let returnValue;

    if (this.checkState(checkTerminated,
        this.#error_codes.RETRIEVE_BEFORE_INIT,
        this.#error_codes.RETRIEVE_AFTER_TERM)) {
      if (checkTerminated) this.lastErrorCode = 0;
      returnValue = this.getCMIValue(CMIElement);
      this.processListeners(callbackName, CMIElement);
    }

    this.apiLog(callbackName, CMIElement, ': returned: ' + returnValue,
        global_constants.LOG_LEVEL_INFO);
    this.clearSCORMError(returnValue);

    return returnValue;
  }

  /**
   * Sets the value of the CMIElement.
   *
   * @param {string} callbackName
   * @param {boolean} checkTerminated
   * @param {string} CMIElement
   * @param {*} value
   * @return {string}
   */
  setValue(
      callbackName: String,
      checkTerminated: boolean,
      CMIElement,
      value) {
    let returnValue = global_constants.SCORM_FALSE;

    if (this.checkState(checkTerminated, this.#error_codes.STORE_BEFORE_INIT,
        this.#error_codes.STORE_AFTER_TERM)) {
      if (checkTerminated) this.lastErrorCode = 0;
      try {
        returnValue = this.setCMIValue(CMIElement, value);
      } catch (e) {
        if (e instanceof ValidationError) {
          this.lastErrorCode = e.errorCode;
          returnValue = global_constants.SCORM_FALSE;
        } else {
          this.throwSCORMError(this.#error_codes.GENERAL);
        }
      }
      this.processListeners(callbackName, CMIElement, value);
    }

    if (returnValue === undefined) {
      returnValue = global_constants.SCORM_FALSE;
    }

    // If we didn't have any errors while setting the data, go ahead and
    // schedule a commit, if autocommit is turned on
    if (String(this.lastErrorCode) === '0') {
      if (this.#settings.autocommit && this.#timeout === undefined) {
        this.scheduleCommit(this.#settings.autocommitSeconds * 1000);
      }
    }

    this.apiLog(callbackName, CMIElement,
        ': ' + value + ': result: ' + returnValue,
        global_constants.LOG_LEVEL_INFO);
    this.clearSCORMError(returnValue);

    return returnValue;
  }

  /**
   * Orders LMS to store all content parameters
   * @param {string} callbackName
   * @param {boolean} checkTerminated
   * @return {string}
   */
  commit(
      callbackName: String,
      checkTerminated: boolean) {
    this.clearScheduledCommit();

    let returnValue = global_constants.SCORM_FALSE;

    if (this.checkState(checkTerminated, this.#error_codes.COMMIT_BEFORE_INIT,
        this.#error_codes.COMMIT_AFTER_TERM)) {
      const result = this.storeData(false);
      if (result.errorCode && result.errorCode > 0) {
        this.throwSCORMError(result.errorCode);
      }
      returnValue = result.result ?
          result.result : global_constants.SCORM_FALSE;

      this.apiLog(callbackName, 'HttpRequest', ' Result: ' + returnValue,
          global_constants.LOG_LEVEL_DEBUG);

      if (checkTerminated) this.lastErrorCode = 0;

      this.processListeners(callbackName);
    }

    this.apiLog(callbackName, null, 'returned: ' + returnValue,
        global_constants.LOG_LEVEL_INFO);
    this.clearSCORMError(returnValue);

    return returnValue;
  }

  /**
   * Returns last error code
   * @param {string} callbackName
   * @return {string}
   */
  getLastError(callbackName: String) {
    const returnValue = String(this.lastErrorCode);

    this.processListeners(callbackName);

    this.apiLog(callbackName, null, 'returned: ' + returnValue,
        global_constants.LOG_LEVEL_INFO);

    return returnValue;
  }

  /**
   * Returns the errorNumber error description
   *
   * @param {string} callbackName
   * @param {(string|number)} CMIErrorCode
   * @return {string}
   */
  getErrorString(callbackName: String, CMIErrorCode) {
    let returnValue = '';

    if (CMIErrorCode !== null && CMIErrorCode !== '') {
      returnValue = this.getLmsErrorMessageDetails(CMIErrorCode);
      this.processListeners(callbackName);
    }

    this.apiLog(callbackName, null, 'returned: ' + returnValue,
        global_constants.LOG_LEVEL_INFO);

    return returnValue;
  }

  /**
   * Returns a comprehensive description of the errorNumber error.
   *
   * @param {string} callbackName
   * @param {(string|number)} CMIErrorCode
   * @return {string}
   */
  getDiagnostic(callbackName: String, CMIErrorCode) {
    let returnValue = '';

    if (CMIErrorCode !== null && CMIErrorCode !== '') {
      returnValue = this.getLmsErrorMessageDetails(CMIErrorCode, true);
      this.processListeners(callbackName);
    }

    this.apiLog(callbackName, null, 'returned: ' + returnValue,
        global_constants.LOG_LEVEL_INFO);

    return returnValue;
  }

  /**
   * Checks the LMS state and ensures it has been initialized.
   *
   * @param {boolean} checkTerminated
   * @param {number} beforeInitError
   * @param {number} afterTermError
   * @return {boolean}
   */
  checkState(
      checkTerminated: boolean,
      beforeInitError: number,
      afterTermError?: number) {
    if (this.isNotInitialized()) {
      this.throwSCORMError(beforeInitError);
      return false;
    } else if (checkTerminated && this.isTerminated()) {
      this.throwSCORMError(afterTermError);
      return false;
    }

    return true;
  }

  /**
   * Logging for all SCORM actions
   *
   * @param {string} functionName
   * @param {string} CMIElement
   * @param {string} logMessage
   * @param {number}messageLevel
   */
  apiLog(
      functionName: String,
      CMIElement: String,
      logMessage: String,
      messageLevel: number) {
    logMessage = this.formatMessage(functionName, CMIElement, logMessage);

    if (messageLevel >= this.apiLogLevel) {
      switch (messageLevel) {
        case global_constants.LOG_LEVEL_ERROR:
          console.error(logMessage);
          break;
        case global_constants.LOG_LEVEL_WARNING:
          console.warn(logMessage);
          break;
        case global_constants.LOG_LEVEL_INFO:
          console.info(logMessage);
          break;
      }
    }
  }

  /**
   * Formats the SCORM messages for easy reading
   *
   * @param {string} functionName
   * @param {string} CMIElement
   * @param {string} message
   * @return {string}
   */
  formatMessage(functionName: String, CMIElement: String, message: String) {
    const baseLength = 20;
    let messageString = '';

    messageString += functionName;

    let fillChars = baseLength - messageString.length;

    for (let i = 0; i < fillChars; i++) {
      messageString += ' ';
    }

    messageString += ': ';

    if (CMIElement) {
      const CMIElementBaseLength = 70;

      messageString += CMIElement;

      fillChars = CMIElementBaseLength - messageString.length;

      for (let j = 0; j < fillChars; j++) {
        messageString += ' ';
      }
    }

    if (message) {
      messageString += message;
    }

    return messageString;
  }

  /**
   * Checks to see if {str} contains {tester}
   *
   * @param {string} str String to check against
   * @param {string} tester String to check for
   * @return {boolean}
   */
  stringMatches(str: String, tester: String) {
    return str && tester && str.match(tester);
  }

  /**
   * Check to see if the specific object has the given property
   * @param {*} refObject
   * @param {string} attribute
   * @return {boolean}
   * @private
   */
  _checkObjectHasProperty(refObject, attribute: String) {
    return Object.hasOwnProperty.call(refObject, attribute) ||
        Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(refObject), attribute) ||
        (attribute in refObject);
  }

  /**
   * Returns the message that corresponds to errorNumber
   * APIs that inherit BaseAPI should override this function
   *
   * @param {(string|number)} _errorNumber
   * @param {boolean} _detail
   * @return {string}
   * @abstract
   */
  getLmsErrorMessageDetails(_errorNumber, _detail) {
    throw new Error(
        'The getLmsErrorMessageDetails method has not been implemented');
  }

  /**
   * Gets the value for the specific element.
   * APIs that inherit BaseAPI should override this function
   *
   * @param {string} _CMIElement
   * @return {string}
   * @abstract
   */
  getCMIValue(_CMIElement) {
    throw new Error('The getCMIValue method has not been implemented');
  }

  /**
   * Sets the value for the specific element.
   * APIs that inherit BaseAPI should override this function
   *
   * @param {string} _CMIElement
   * @param {any} _value
   * @return {string}
   * @abstract
   */
  setCMIValue(_CMIElement, _value) {
    throw new Error('The setCMIValue method has not been implemented');
  }

  /**
   * Shared API method to set a valid for a given element.
   *
   * @param {string} methodName
   * @param {boolean} scorm2004
   * @param {string} CMIElement
   * @param {*} value
   * @return {string}
   */
  _commonSetCMIValue(
      methodName: String, scorm2004: boolean, CMIElement, value) {
    if (!CMIElement || CMIElement === '') {
      return global_constants.SCORM_FALSE;
    }

    const structure = CMIElement.split('.');
    let refObject = this;
    let returnValue = global_constants.SCORM_FALSE;
    let foundFirstIndex = false;

    const invalidErrorMessage = `The data model element passed to ${methodName} (${CMIElement}) is not a valid SCORM data model element.`;
    const invalidErrorCode = scorm2004 ?
        this.#error_codes.UNDEFINED_DATA_MODEL :
        this.#error_codes.GENERAL;

    for (let i = 0; i < structure.length; i++) {
      const attribute = structure[i];

      if (i === structure.length - 1) {
        if (scorm2004 && (attribute.substr(0, 8) === '{target=') &&
            (typeof refObject._isTargetValid == 'function')) {
          this.throwSCORMError(this.#error_codes.READ_ONLY_ELEMENT);
        } else if (!this._checkObjectHasProperty(refObject, attribute)) {
          this.throwSCORMError(invalidErrorCode, invalidErrorMessage);
        } else {
          if (this.stringMatches(CMIElement, '\\.correct_responses\\.\\d')) {
            this.validateCorrectResponse(CMIElement, value);
          }

          if (!scorm2004 || this.lastErrorCode === 0) {
            refObject[attribute] = value;
            returnValue = global_constants.SCORM_TRUE;
          }
        }
      } else {
        refObject = refObject[attribute];
        if (!refObject) {
          this.throwSCORMError(invalidErrorCode, invalidErrorMessage);
          break;
        }

        if (refObject instanceof CMIArray) {
          const index = parseInt(structure[i + 1], 10);

          // SCO is trying to set an item on an array
          if (!isNaN(index)) {
            const item = refObject.childArray[index];

            if (item) {
              refObject = item;
            } else {
              const newChild = this.getChildElement(CMIElement, value,
                  foundFirstIndex);
              foundFirstIndex = true;

              if (!newChild) {
                this.throwSCORMError(invalidErrorCode, invalidErrorMessage);
              } else {
                if (refObject.initialized) newChild.initialize();

                refObject.childArray.push(newChild);
                refObject = newChild;
              }
            }

            // Have to update i value to skip the array position
            i++;
          }
        }
      }
    }

    if (returnValue === global_constants.SCORM_FALSE) {
      this.apiLog(methodName, null,
          `There was an error setting the value for: ${CMIElement}, value of: ${value}`,
          global_constants.LOG_LEVEL_WARNING);
    }

    return returnValue;
  }

  /**
   * Abstract method for validating that a response is correct.
   *
   * @param {string} _CMIElement
   * @param {*} _value
   */
  validateCorrectResponse(_CMIElement, _value) {
    // just a stub method
  }

  /**
   * Gets or builds a new child element to add to the array.
   * APIs that inherit BaseAPI should override this method.
   *
   * @param {string} _CMIElement - unused
   * @param {*} _value - unused
   * @param {boolean} _foundFirstIndex - unused
   * @return {*}
   * @abstract
   */
  getChildElement(_CMIElement, _value, _foundFirstIndex) {
    throw new Error('The getChildElement method has not been implemented');
  }

  /**
   * Gets a value from the CMI Object
   *
   * @param {string} methodName
   * @param {boolean} scorm2004
   * @param {string} CMIElement
   * @return {*}
   */
  _commonGetCMIValue(methodName: String, scorm2004: boolean, CMIElement) {
    if (!CMIElement || CMIElement === '') {
      return '';
    }

    const structure = CMIElement.split('.');
    let refObject = this;
    let attribute = null;

    const uninitializedErrorMessage = `The data model element passed to ${methodName} (${CMIElement}) has not been initialized.`;
    const invalidErrorMessage = `The data model element passed to ${methodName} (${CMIElement}) is not a valid SCORM data model element.`;
    const invalidErrorCode = scorm2004 ?
        this.#error_codes.UNDEFINED_DATA_MODEL :
        this.#error_codes.GENERAL;

    for (let i = 0; i < structure.length; i++) {
      attribute = structure[i];

      if (!scorm2004) {
        if (i === structure.length - 1) {
          if (!this._checkObjectHasProperty(refObject, attribute)) {
            this.throwSCORMError(invalidErrorCode, invalidErrorMessage);
            return;
          }
        }
      } else {
        if ((String(attribute).substr(0, 8) === '{target=') &&
            (typeof refObject._isTargetValid == 'function')) {
          const target = String(attribute).
              substr(8, String(attribute).length - 9);
          return refObject._isTargetValid(target);
        } else if (!this._checkObjectHasProperty(refObject, attribute)) {
          this.throwSCORMError(invalidErrorCode, invalidErrorMessage);
          return;
        }
      }

      refObject = refObject[attribute];
      if (!refObject) {
        this.throwSCORMError(invalidErrorCode, invalidErrorMessage);
        break;
      }

      if (refObject instanceof CMIArray) {
        const index = parseInt(structure[i + 1], 10);

        // SCO is trying to set an item on an array
        if (!isNaN(index)) {
          const item = refObject.childArray[index];

          if (item) {
            refObject = item;
          } else {
            this.throwSCORMError(this.#error_codes.VALUE_NOT_INITIALIZED,
                uninitializedErrorMessage);
            break;
          }

          // Have to update i value to skip the array position
          i++;
        }
      }
    }

    if (refObject === null || refObject === undefined) {
      if (!scorm2004) {
        if (attribute === '_children') {
          this.throwSCORMError(scorm12_error_codes.CHILDREN_ERROR);
        } else if (attribute === '_count') {
          this.throwSCORMError(scorm12_error_codes.COUNT_ERROR);
        }
      }
    } else {
      return refObject;
    }
  }

  /**
   * Returns true if the API's current state is STATE_INITIALIZED
   *
   * @return {boolean}
   */
  isInitialized() {
    return this.currentState === global_constants.STATE_INITIALIZED;
  }

  /**
   * Returns true if the API's current state is STATE_NOT_INITIALIZED
   *
   * @return {boolean}
   */
  isNotInitialized() {
    return this.currentState === global_constants.STATE_NOT_INITIALIZED;
  }

  /**
   * Returns true if the API's current state is STATE_TERMINATED
   *
   * @return {boolean}
   */
  isTerminated() {
    return this.currentState === global_constants.STATE_TERMINATED;
  }

  /**
   * Provides a mechanism for attaching to a specific SCORM event
   *
   * @param {string} listenerName
   * @param {function} callback
   */
  on(listenerName: String, callback: function) {
    if (!callback) return;

    const listenerFunctions = listenerName.split(' ');
    for (let i = 0; i < listenerFunctions.length; i++) {
      const listenerSplit = listenerFunctions[i].split('.');
      if (listenerSplit.length === 0) return;

      const functionName = listenerSplit[0];

      let CMIElement = null;
      if (listenerSplit.length > 1) {
        CMIElement = listenerName.replace(functionName + '.', '');
      }

      this.listenerArray.push({
        functionName: functionName,
        CMIElement: CMIElement,
        callback: callback,
      });
    }
  }

  /**
   * Processes any 'on' listeners that have been created
   *
   * @param {string} functionName
   * @param {string} CMIElement
   * @param {*} value
   */
  processListeners(functionName: String, CMIElement: String, value: any) {
    for (let i = 0; i < this.listenerArray.length; i++) {
      const listener = this.listenerArray[i];
      const functionsMatch = listener.functionName === functionName;
      const listenerHasCMIElement = !!listener.CMIElement;
      const CMIElementsMatch = listener.CMIElement === CMIElement;

      if (functionsMatch && (!listenerHasCMIElement || CMIElementsMatch)) {
        listener.callback(CMIElement, value);
      }
    }
  }

  /**
   * Throws a SCORM error
   *
   * @param {number} errorNumber
   * @param {string} message
   */
  throwSCORMError(errorNumber: number, message: String) {
    if (!message) {
      message = this.getLmsErrorMessageDetails(errorNumber);
    }

    this.apiLog('throwSCORMError', null, errorNumber + ': ' + message,
        global_constants.LOG_LEVEL_ERROR);

    this.lastErrorCode = String(errorNumber);
  }

  /**
   * Clears the last SCORM error code on success.
   *
   * @param {string} success
   */
  clearSCORMError(success: String) {
    if (success !== undefined && success !== global_constants.SCORM_FALSE) {
      this.lastErrorCode = 0;
    }
  }

  /**
   * Attempts to store the data to the LMS, logs data if no LMS configured
   * APIs that inherit BaseAPI should override this function
   *
   * @param {boolean} _calculateTotalTime
   * @return {string}
   * @abstract
   */
  storeData(_calculateTotalTime) {
    throw new Error(
        'The storeData method has not been implemented');
  }

  /**
   * Loads CMI data from a JSON object.
   *
   * @param {object} json
   * @param {string} CMIElement
   */
  loadFromJSON(json, CMIElement) {
    if (!this.isNotInitialized()) {
      console.error(
          'loadFromJSON can only be called before the call to lmsInitialize.');
      return;
    }

    CMIElement = CMIElement || 'cmi';

    this.startingData = json;

    for (const key in json) {
      if ({}.hasOwnProperty.call(json, key) && json[key]) {
        const currentCMIElement = CMIElement + '.' + key;
        const value = json[key];

        if (value['childArray']) {
          for (let i = 0; i < value['childArray'].length; i++) {
            this.loadFromJSON(value['childArray'][i],
                currentCMIElement + '.' + i);
          }
        } else if (value.constructor === Object) {
          this.loadFromJSON(value, currentCMIElement);
        } else {
          this.setCMIValue(currentCMIElement, value);
        }
      }
    }
  }

  /**
   * Render the CMI object to JSON for sending to an LMS.
   *
   * @return {string}
   */
  renderCMIToJSONString() {
    const cmi = this.cmi;
    // Do we want/need to return fields that have no set value?
    // return JSON.stringify({ cmi }, (k, v) => v === undefined ? null : v, 2);
    return JSON.stringify({cmi});
  }

  /**
   * Returns a JS object representing the current cmi
   * @return {object}
   */
  renderCMIToJSONObject() {
    // Do we want/need to return fields that have no set value?
    // return JSON.stringify({ cmi }, (k, v) => v === undefined ? null : v, 2);
    return JSON.parse(this.renderCMIToJSONString());
  }

  /**
   * Render the cmi object to the proper format for LMS commit
   * APIs that inherit BaseAPI should override this function
   *
   * @param {boolean} _terminateCommit
   * @return {*}
   * @abstract
   */
  renderCommitCMI(_terminateCommit) {
    throw new Error(
        'The storeData method has not been implemented');
  }

  /**
   * Send the request to the LMS
   * @param {string} url
   * @param {object|Array} params
   * @return {object}
   */
  processHttpRequest(url: String, params) {
    const httpReq = new XMLHttpRequest();
    httpReq.open('POST', url, false);
    httpReq.setRequestHeader('Content-Type',
        'application/x-www-form-urlencoded');
    try {
      if (params instanceof Array) {
        httpReq.send(params.join('&'));
      } else {
        httpReq.send(params);
      }
    } catch (e) {
      return {
        'result': global_constants.SCORM_FALSE,
        'errorCode': this.#error_codes.GENERAL,
      };
    }

    return JSON.parse(httpReq.responseText);
  }

  /**
   * Throws a SCORM error
   *
   * @param {number} when - the number of milliseconds to wait before committing
   */
  scheduleCommit(when: number) {
    this.#timeout = new ScheduledCommit(this, when);
  }

  /**
   * Clears and cancels any currently scheduled commits
   */
  clearScheduledCommit() {
    if (this.#timeout) {
      this.#timeout.cancel();
      this.#timeout = null;
    }
  }
}

/**
 * Private class that wraps a timeout call to the commit() function
 */
class ScheduledCommit {
  #API;
  #cancelled: false;
  #timeout;

  /**
   * Constructor for ScheduledCommit
   * @param {BaseAPI} API
   * @param {number} when
   */
  constructor(API: any, when: number) {
    this.#API = API;
    this.#timeout = setTimeout(this.wrapper, when);
  }

  /**
   * Cancel any currently scheduled commit
   */
  cancel() {
    this.#cancelled = true;
    if (this.#timeout) {
      clearTimeout(this.#timeout);
    }
  }

  /**
   * Wrap the API commit call to check if the call has already been cancelled
   */
  wrapper() {
    if (!this.#cancelled) {
      this.#API.commit();
    }
  }
}

// @flow
import BaseAPI from './BaseAPI';
import {
  CMI,
  CMIInteractionsCorrectResponsesObject,
  CMIInteractionsObject,
  CMIInteractionsObjectivesObject,
  CMIObjectivesObject,
} from './cmi/scorm12_cmi';
import * as Utilities from './utilities';
import {global_constants, scorm12_constants} from './constants/api_constants';
import {scorm12_error_codes} from './constants/error_codes';

const constants = scorm12_constants;

/**
 * API class for SCORM 1.2
 */
export default class Scorm12API extends BaseAPI {
  /**
   * Constructor for SCORM 1.2 API
   * @param {object} settings
   */
  constructor(settings: {}) {
    const finalSettings = {
      ...{
        mastery_override: false,
      }, ...settings,
    };

    super(scorm12_error_codes, finalSettings);

    this.cmi = new CMI();
    // Rename functions to match 1.2 Spec and expose to modules
    this.LMSInitialize = this.lmsInitialize;
    this.LMSFinish = this.lmsFinish;
    this.LMSGetValue = this.lmsGetValue;
    this.LMSSetValue = this.lmsSetValue;
    this.LMSCommit = this.lmsCommit;
    this.LMSGetLastError = this.lmsGetLastError;
    this.LMSGetErrorString = this.lmsGetErrorString;
    this.LMSGetDiagnostic = this.lmsGetDiagnostic;
  }

  /**
   * lmsInitialize function from SCORM 1.2 Spec
   *
   * @return {string} bool
   */
  lmsInitialize() {
    this.cmi.initialize();
    return this.initialize('LMSInitialize', 'LMS was already initialized!',
        'LMS is already finished!');
  }

  /**
   * LMSFinish function from SCORM 1.2 Spec
   *
   * @return {string} bool
   */
  lmsFinish() {
    return this.terminate('LMSFinish', false);
  }

  /**
   * LMSGetValue function from SCORM 1.2 Spec
   *
   * @param {string} CMIElement
   * @return {string}
   */
  lmsGetValue(CMIElement) {
    return this.getValue('LMSGetValue', false, CMIElement);
  }

  /**
   * LMSSetValue function from SCORM 1.2 Spec
   *
   * @param {string} CMIElement
   * @param {*} value
   * @return {string}
   */
  lmsSetValue(CMIElement, value) {
    return this.setValue('LMSSetValue', false, CMIElement, value);
  }

  /**
   * LMSCommit function from SCORM 1.2 Spec
   *
   * @return {string} bool
   */
  lmsCommit() {
    return this.commit('LMSCommit', false);
  }

  /**
   * LMSGetLastError function from SCORM 1.2 Spec
   *
   * @return {string}
   */
  lmsGetLastError() {
    return this.getLastError('LMSGetLastError');
  }

  /**
   * LMSGetErrorString function from SCORM 1.2 Spec
   *
   * @param {string} CMIErrorCode
   * @return {string}
   */
  lmsGetErrorString(CMIErrorCode) {
    return this.getErrorString('LMSGetErrorString', CMIErrorCode);
  }

  /**
   * LMSGetDiagnostic function from SCORM 1.2 Spec
   *
   * @param {string} CMIErrorCode
   * @return {string}
   */
  lmsGetDiagnostic(CMIErrorCode) {
    return this.getDiagnostic('LMSGetDiagnostic', CMIErrorCode);
  }

  /**
   * Sets a value on the CMI Object
   *
   * @param {string} CMIElement
   * @param {*} value
   * @return {string}
   */
  setCMIValue(CMIElement, value) {
    return this._commonSetCMIValue('LMSSetValue', false, CMIElement, value);
  }

  /**
   * Gets a value from the CMI Object
   *
   * @param {string} CMIElement
   * @return {*}
   */
  getCMIValue(CMIElement) {
    return this._commonGetCMIValue('getCMIValue', false, CMIElement);
  }

  /**
   * Gets or builds a new child element to add to the array.
   *
   * @param {string} CMIElement
   * @param {*} value
   * @param {boolean} foundFirstIndex
   * @return {object}
   */
  getChildElement(CMIElement, value, foundFirstIndex) {
    let newChild;

    if (this.stringMatches(CMIElement, 'cmi\\.objectives\\.\\d')) {
      newChild = new CMIObjectivesObject();
    } else if (foundFirstIndex && this.stringMatches(CMIElement,
        'cmi\\.interactions\\.\\d\\.correct_responses\\.\\d')) {
      newChild = new CMIInteractionsCorrectResponsesObject();
    } else if (foundFirstIndex && this.stringMatches(CMIElement,
        'cmi\\.interactions\\.\\d\\.objectives\\.\\d')) {
      newChild = new CMIInteractionsObjectivesObject();
    } else if (this.stringMatches(CMIElement, 'cmi\\.interactions\\.\\d')) {
      newChild = new CMIInteractionsObject();
    }

    return newChild;
  }

  /**
   * Validates Correct Response values
   *
   * @param {string} CMIElement
   * @param {*} value
   * @return {boolean}
   */
  validateCorrectResponse(CMIElement, value) {
    return true;
  }

  /**
   * Returns the message that corresponds to errorNumber.
   *
   * @param {*} errorNumber
   * @param {boolean }detail
   * @return {string}
   */
  getLmsErrorMessageDetails(errorNumber, detail) {
    let basicMessage = 'No Error';
    let detailMessage = 'No Error';

    // Set error number to string since inconsistent from modules if string or number
    errorNumber = String(errorNumber);
    if (constants.error_descriptions[errorNumber]) {
      basicMessage = constants.error_descriptions[errorNumber].basicMessage;
      detailMessage = constants.error_descriptions[errorNumber].detailMessage;
    }

    return detail ? detailMessage : basicMessage;
  }

  /**
   * Replace the whole API with another
   *
   * @param {Scorm12API} newAPI
   */
  replaceWithAnotherScormAPI(newAPI) {
    // Data Model
    this.cmi = newAPI.cmi;
  }

  /**
   * Render the cmi object to the proper format for LMS commit
   *
   * @param {boolean} terminateCommit
   * @return {object|Array}
   */
  renderCommitCMI(terminateCommit: boolean) {
    const cmiExport = this.renderCMIToJSONObject();

    if (terminateCommit) {
      cmiExport.cmi.core.total_time = this.cmi.getCurrentTotalTime();
    }

    const result = [];
    const flattened = Utilities.flatten(cmiExport);
    switch (this.settings.dataCommitFormat) {
      case 'flattened':
        return Utilities.flatten(cmiExport);
      case 'params':
        for (const item in flattened) {
          if ({}.hasOwnProperty.call(flattened, item)) {
            result.push(`${item}=${flattened[item]}`);
          }
        }
        return result;
      case 'json':
      default:
        return cmiExport;
    }
  }

  /**
   * Attempts to store the data to the LMS
   *
   * @param {boolean} terminateCommit
   * @return {string}
   */
  storeData(terminateCommit: boolean) {
    if (terminateCommit) {
      const originalStatus = this.cmi.core.lesson_status;
      if (originalStatus === 'not attempted') {
        this.cmi.core.lesson_status = 'completed';
      }

      if (this.cmi.core.lesson_mode === 'normal') {
        if (this.cmi.core.credit === 'credit') {
          if (this.settings.mastery_override &&
              this.cmi.student_data.mastery_score !== '' &&
              this.cmi.core.score.raw !== '') {
            if (parseFloat(this.cmi.core.score.raw) >=
                parseFloat(this.cmi.student_data.mastery_score)) {
              this.cmi.core.lesson_status = 'passed';
            } else {
              this.cmi.core.lesson_status = 'failed';
            }
          }
        }
      } else if (this.cmi.core.lesson_mode === 'browse') {
        if ((this.startingData?.cmi?.core?.lesson_status || '') === '' &&
            originalStatus === 'not attempted') {
          this.cmi.core.lesson_status = 'browsed';
        }
      }
    }

    const commitObject = this.renderCommitCMI(terminateCommit);

    if (this.settings.lmsCommitUrl) {
      if (this.apiLogLevel === global_constants.LOG_LEVEL_DEBUG) {
        console.debug('Commit (terminated: ' +
            (terminateCommit ? 'yes' : 'no') + '): ');
        console.debug(commitObject);
      }
      return this.processHttpRequest(this.settings.lmsCommitUrl, commitObject);
    } else {
      console.log('Commit (terminated: ' +
          (terminateCommit ? 'yes' : 'no') + '): ');
      console.log(commitObject);
      return global_constants.SCORM_TRUE;
    }
  }
}

window.Scorm12API = Scorm12API;

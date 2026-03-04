import config from './config.js';

class Sensource {

  constructor() {

    this._accessToken = null;
    this._accessTokenPromise = null;
  }

  accessTokenIsExpired(){
    const expiresIn = this._accessToken?.expires_in;
    if ( !expiresIn ) return true;
    const refreshBuffer = 30; // seconds before actual expiration to consider the token expired
    const expiresAt = this._accessToken.created_at + (expiresIn * 1000) - (refreshBuffer * 1000);
    const isExpired = Date.now() > expiresAt;
    if ( isExpired ){
      console.log('Sensource token expired', {data: {createdAt: this._accessToken.created_at, expiresAt}});
    }
    return isExpired;
  }

  async getAccessToken() {
    if ( this.accessTokenIsExpired() ){
      if ( !this._promise ){
        this._promise = this._getAccessToken();
      }
      await this._promise;
      this._promise = null;
    }
    return this._accessToken.access_token;
  }

  async _getAccessToken() {
    console.log('Getting Sensource token');
    const response = await fetch(config.sensource.authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: config.sensource.clientId,
        client_secret: config.sensource.clientSecret,
        grant_type: 'client_credentials'
      })
    });

    if ( !response.ok ){
      throw new Error(`Error getting Sensource token: ${response.status} ${response.statusText}`);
    }

    console.log('Got Sensource token');
    this._accessToken = await response.json();
    this._accessToken.created_at = Date.now();

    return this._accessToken.access_token;
  }

  /**
   * @description Get the occupancy data from the Sensource API
   * @param {Object} query - The query parameters
   * @returns {Array} - Array of occupancy data
   */
  async getOccupancyData(query){
    if ( !query.metrics) {
      query = {...query, metrics: 'occupancy(avg)'};
    }
    query.entityType = 'space';
    if ( !query.endDate ){
      delete query.endDate;
    }
    console.log('Getting occupancy data from Sensource', {query});
    let data = await this._get('data/occupancy', query);
    if ( data?.messages?.length  ){
      console.log('messages from occupancy call to sensource', {messages: data.messages});
    }
    if ( !data?.results ){
      throw new Error('Results array not found in Sensource data');
    }
    data = data.results;
    return data;
  }

  getSpaces(){
    return this._get('space');
  }

  /**
   * @description Fetch data from Sensource API
   * @param {String} path - The path to the API endpoint
   * @param {Object} query - Any url query parameters
   * @param {Object} params - Any additional fetch parameters
   * @returns
   */
  async _get(path, query={}, params={}){
    const token = await this.getAccessToken();
    let url = `${config.sensource.apiUrl}/${path}`;
    if ( Object.keys(query).length > 0 ){
      url += '?' + new URLSearchParams(query);
    }

    if ( !params.headers ){
      params.headers = {
        'Authorization': `Bearer ${token}`,
        'accept': 'application/json'
      };
    }

    console.log(`Getting Sensource data`, {data: {path, query, url}});
    const response = await fetch(url, params);
    if ( !response.ok ){
      try {        
        const errorData = await response.json();
        console.error('Sensource error response', {data: errorData});
      } catch (e){
      }
      throw new Error(`Error getting Sensource data: ${response.status} ${response.statusText}`);
    }
    console.log(`Got Sensource data`, {data: {path, query, url}});
    return response.json();
  }

}

export default new Sensource()
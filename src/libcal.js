import config from './config.js';

class Libcal {

  constructor() {
    this._accessToken = null;
  }

  async getAccessToken() {
    if ( this._accessToken ) return this._accessToken;
    const url = `${config.libcal.url}/oauth/token`;
    const payload = {
      client_id: config.libcal.clientId,
      client_secret: config.libcal.clientSecret,
      grant_type: 'client_credentials'
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if ( !r.ok ){
      throw new Error(`Error getting Libcal access token: ${r.status} ${r.statusText}`);
    }

    const data = await r.json();
    this._accessToken = data.access_token;
    return this._accessToken;
  }

  async getHours(locationId, startDate, endDate){
    const token = await this.getAccessToken();
    const url = `${config.libcal.url}/hours/${locationId}?from=${startDate}&to=${endDate}`;
    console.log('Getting Libcal hours with URL:', url);
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    if ( !r.ok ){
      throw new Error(`Error getting Libcal hours: ${r.status} ${r.statusText}`);
    }
    return await r.json();
  }

}

export default new Libcal();
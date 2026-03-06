import 'dotenv/config';

class Config {

  constructor() {
    this.sensource = {
      clientId: process.env.SENSOURCE_CLIENT_ID,
      clientSecret: process.env.SENSOURCE_CLIENT_SECRET,
      authUrl: 'https://auth.sensourceinc.com/oauth/token',
      apiUrl: 'https://vea.sensourceinc.com/api'
    }

    this.libcal = {
      clientId: process.env.LIBCAL_CLIENT_ID,
      clientSecret: process.env.LIBCAL_CLIENT_SECRET,
      url: 'https://reservations.library.ucdavis.edu/api/1.1'
    }
  }


}

export default new Config()
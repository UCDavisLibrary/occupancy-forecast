import 'dotenv/config';

class Config {

  constructor() {
    this.sensource = {
      clientId: process.env.SENSOURCE_CLIENT_ID,
      clientSecret: process.env.SENSOURCE_CLIENT_SECRET,
      authUrl: 'https://auth.sensourceinc.com/oauth/token',
      apiUrl: 'https://vea.sensourceinc.com/api'
    }
  }


}

export default new Config()
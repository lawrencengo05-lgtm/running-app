import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Amplify } from 'aws-amplify'
import App from './App.jsx'

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'us-east-1_FJ9zaSTNk',
      userPoolClientId: '99k9j8orcnfqh0taci2a5pq4p',
      signUpVerificationMethod: 'code',
      loginWith: {
        email: true
      }
    }
  }
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
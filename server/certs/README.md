# GigaChat TLS certificate

`russian-trusted-root-ca.pem` is the public Russian Trusted Root CA certificate linked by the [official GigaChat certificate instructions](https://developers.sber.ru/docs/ru/gigachat/certificates). The file was downloaded from `https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt` and checked against the SHA-256 certificate fingerprint `D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31` before inclusion. It contains no private key.

Only the Node API process loads this additional CA through `NODE_EXTRA_CA_CERTS`. TLS hostname and certificate validation remain enabled. The GigaChat authorization key stays in ignored `server/.env` or a deployment secret.

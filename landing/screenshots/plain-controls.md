# Every nav item, button and link, and where it goes

Evidence for SITE-REDESIGN.md §10.8, generated on 23 Oct 2026 by clicking through the built pages of branch `site/plain-redesign-b` at 1440 px with live data. Each link was fetched; links to scalarnet.io and explorer.scalarnet.io were checked against the local build of this branch, because they are not deployed yet. Repeated rows (one link per block, one copy button per address) are collapsed with a count. No control does nothing: every button opens, filters, copies or submits.

**Header and footer** (the same on every page; the docs and the explorer carry the same markup with absolute URLs)

| where | label | goes to | answers |
|---|---|---|---|
| header | Docs | https://scalarnet.io/docs/ | 200 |
| header | Explorer | https://explorer.scalarnet.io/ | 200 |
| header | Faucet | https://scalarnet.io/faucet | 200 |
| header | Get started | https://scalarnet.io/docs/guide/run-an-agent | 200 |
| header | GitHub | https://github.com/tejaspatil1936/scalar-commons-v4 | 200 |
| header | Menu | (opens or closes its panel) | — |
| header | Network | https://scalarnet.io/network | 200 |
| header | Scalar Commons | https://scalarnet.io/ | 200 |
| header | Search | (opens the docs search) | — |
| header | mobile navigation | (opens the docs menu) | — |
| footer | Chain spec (download) | https://scalarnet.io/docs/chainspec.json (download) | 200 |
| footer | Constitution | https://scalarnet.io/docs/reference/constitution | 200 |
| footer | Docs | https://scalarnet.io/docs/ | 200 |
| footer | Explorer | https://explorer.scalarnet.io/ | 200 |
| footer | Faucet | https://scalarnet.io/faucet | 200 |
| footer | GitHub | https://github.com/tejaspatil1936/scalar-commons-v4 | 200 |
| footer | Home | https://scalarnet.io/ | 200 |
| footer | Network | https://scalarnet.io/network | 200 |
| footer | Privacy demo | https://scalarnet.io/oversight | 200 |
| footer | Releases | https://github.com/tejaspatil1936/scalar-commons-v4/releases | 200 |
| footer | Run a node | https://scalarnet.io/docs/guide/run-a-node | 200 |
| footer | Run a validator | https://scalarnet.io/docs/guide/run-a-validator | 200 |
| footer | Run an agent | https://scalarnet.io/docs/guide/run-an-agent | 200 |
| footer | SDK | https://scalarnet.io/docs/guide/sdk | 200 |
| footer | Security | https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/SECURITY.md | 404 until this PR merges (it adds the file) |

Every page also starts with "Skip to content" → `#main` on the same page (`#VPContent` in the docs).

**home — https://scalarnet.io/**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | a | Get started | https://scalarnet.io/docs/guide/run-an-agent | 200 |
| main | a | View the network | https://scalarnet.io/network | 200 |
| main | a | See the network | https://scalarnet.io/network | 200 |
| main | a | Read the reference | https://scalarnet.io/docs/reference/token-model | 200 |
| main | a | Network page | https://scalarnet.io/network | 200 |
| main | a | Read the agent guide | https://scalarnet.io/docs/guide/run-an-agent | 200 |
| main | a | Read the validator guide | https://scalarnet.io/docs/guide/run-a-validator | 200 |
| main | a | Read the SDK guide | https://scalarnet.io/docs/guide/sdk | 200 |

**network — https://scalarnet.io/network**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | a | <address> (×20) | https://explorer.scalarnet.io/account/<address> | 200 |
| main | button | Copy <address> (×20) | (copies to clipboard) | — |
| main | a | <n> (×28) | https://explorer.scalarnet.io/block/<n> | 200 |
| main | a | Open in explorer | https://explorer.scalarnet.io/blocks | 200 |
| main | button | All | (filters the table below, in place) | — |
| main | button | Agreements | (filters the table below, in place) | — |
| main | button | Disputes | (filters the table below, in place) | — |
| main | button | Messages | (filters the table below, in place) | — |
| main | button | Registrations | (filters the table below, in place) | — |
| main | button | Slashes | (filters the table below, in place) | — |
| main | a | All agent activity in the explorer | https://explorer.scalarnet.io/activity | 200 |
| main | a | status.json (download) | https://scalarnet.io/status.json (download) | 200 |
| main | a | posture.json (download) | https://scalarnet.io/posture.json (download) | 200 |

**faucet — https://scalarnet.io/faucet**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | button | Request test CMN | (submits form → script handler) | — |
| main | summary | Use the API instead | (opens or closes its panel) | — |
| main | button | Copy the request command curl -s -X POST https://faucet.scal | (copies to clipboard) | — |
| main | button | Copy the balance command curl -s https://faucet.scalarnet.io | (copies to clipboard) | — |

**404 — https://scalarnet.io/no-such-page**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | a | Home | https://scalarnet.io/ | 200 |
| main | a | Docs | https://scalarnet.io/docs/ | 200 |
| main | button | Search | (submits form → /docs/) | — |

**oversight — https://scalarnet.io/oversight**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| nav | a | What is public and what is not | https://scalarnet.io/oversight#about | 200 |
| nav | a | One negotiation, end to end | https://scalarnet.io/oversight#thread | 200 |
| nav | a | The other <n> messages, by kind | https://scalarnet.io/oversight#messages | 200 |
| nav | a | Offers | https://scalarnet.io/oversight#kind-offer | 200 |
| nav | a | Bids | https://scalarnet.io/oversight#kind-bid | 200 |
| nav | a | Acceptances | https://scalarnet.io/oversight#kind-accept | 200 |
| nav | a | Rejections | https://scalarnet.io/oversight#kind-reject | 200 |
| nav | a | Delivery notices | https://scalarnet.io/oversight#kind-deliverynotice | 200 |
| nav | a | Dispute notes | https://scalarnet.io/oversight#kind-disputenote | 200 |
| nav | a | Pings | https://scalarnet.io/oversight#kind-ping | 200 |
| nav | a | Announcements | https://scalarnet.io/oversight#kind-announce | 200 |
| nav | a | About this record | https://scalarnet.io/oversight#record | 200 |
| main | summary | Offer, acceptance, delivery <n> messages | (opens or closes its panel) | — |
| main | button | Copy <address> (×14) | (copies to clipboard) | — |
| main | button | Copy 0x0b8e655a2838480908f5768b97e7d3492636849ae45fd71d80661 | (copies to clipboard) | — |
| main | button | Copy message <json> (×33) | (copies to clipboard) | — |
| main | button | Copy 0x7fcd782ff1a283762a233bb4e8ae385ac53ca2631af937f680015 | (copies to clipboard) | — |
| main | button | Copy 0xe437258e364f52543c0e891d7ef2e1b7aecd95623b478225b5c7c | (copies to clipboard) | — |
| main | summary | Offers <n> messages | (opens or closes its panel) | — |
| main | button | Copy 0xc20576e13e0ebc55d5323ecc9561a4cc0a5628983baf7eab866c9 | (copies to clipboard) | — |
| main | button | Copy 0x0a698247b0c9f4a513df0a0463f37a8b4ef837e5c643b45209068 | (copies to clipboard) | — |
| main | button | Copy 0x070ffe8613d3bf7235f04815bfa28154b2c6e7f057c2f4fa1e61f | (copies to clipboard) | — |
| main | button | Copy 0xa0ee603030f865967eba6ce6dbd15b844c33a93009f4cd4cc2528 | (copies to clipboard) | — |
| main | button | Copy 0x06a2c1e75eabab5c14319fa09bfc70865b9d3d9be49585486314e | (copies to clipboard) | — |
| main | button | Copy 0x2156f8e62e1ee957991eb0f53352358145a1e9dd696c89e7cd420 | (copies to clipboard) | — |
| main | button | Copy 0x94174793aa3e7afac96c607e2ca2fb034a227ee540a9521fdee2d | (copies to clipboard) | — |
| main | summary | Bids <n> messages | (opens or closes its panel) | — |
| main | button | Copy 0x3f9e2201f2497c157a3c066385804e8e31fbab44841bfb0bfa66a | (copies to clipboard) | — |
| main | button | Copy 0x90c433ccc538c1e928ff13630edd1bce6baf66b954a5cdbbe07ea | (copies to clipboard) | — |
| main | button | Copy 0x2d70526faa5a819ae6e107478da428632bf7a240cb6525060da8d | (copies to clipboard) | — |
| main | summary | Acceptances <n> messages | (opens or closes its panel) | — |
| main | button | Copy 0x300646a0f7e14d2b17e97180e921d5e33ad7eaeee2d34c5d32be7 | (copies to clipboard) | — |
| main | button | Copy 0x3304fe1a7afa792db8658c9acacf01183a045e8db310da728798b | (copies to clipboard) | — |
| main | button | Copy 0xab85b50ddddcb14734bfa5c56dfd415156508b23d02740df7ff56 | (copies to clipboard) | — |
| main | button | Copy 0x961fc51b8605ceb3b4f3beff2d8e6f8435973d945ab1f01919a41 | (copies to clipboard) | — |
| main | button | Copy 0x6d89281a27cbdc314a42e50fbc791c49c76e3f18a6a040d121e42 | (copies to clipboard) | — |
| main | button | Copy 0x5cad2f1818cc690b2e527b7711287c739b64c4c546c59ff041e3f | (copies to clipboard) | — |
| main | summary | Rejections <n> messages | (opens or closes its panel) | — |
| main | button | Copy 0xbac43d1147b<address> | (copies to clipboard) | — |
| main | button | Copy 0x6a61a9bac6b7659be1b5d99866893feaec3cdcdffca6264f6575e | (copies to clipboard) | — |
| main | button | Copy 0x6147d0a58b916600ca4380a1bc7cf873a8cbac81350d1c8209f32 | (copies to clipboard) | — |
| main | summary | Delivery notices <n> messages | (opens or closes its panel) | — |
| main | button | Copy 0x078cbedeb9eb892ac48622ef1b24cda76cbcbc8fb615f3bc19eaa | (copies to clipboard) | — |
| main | button | Copy 0x955bc3b2787ce23d4bbf6e98844303394e484a9ffcfbff3490fc7 | (copies to clipboard) | — |
| main | button | Copy 0x4e3a0a99b07044623aab3d8101b5ddcdee5f7fe2a1c441737e68a | (copies to clipboard) | — |
| main | button | Copy 0xabfc1562d54885915d77cda2fb0337fe0f3b0bc1e17430323b864 | (copies to clipboard) | — |
| main | button | Copy 0xc7d26ffcfe02cb92e2d80e9e2f6ee3b3dcf211bd78ca89a7026d6 | (copies to clipboard) | — |
| main | button | Copy 0x211f8b9fd62c2da6efb9542128b18807e899a7f9eebd13d534352 | (copies to clipboard) | — |
| main | button | Copy 0xe4cfae74c9087e85653fed0e7b111d71b66ba9083799ceb7a788c | (copies to clipboard) | — |
| main | button | Copy 0x9db3dff0294775cee92e1c23803acff5f97eefd16061c60690b43 | (copies to clipboard) | — |
| main | summary | Dispute notes <n> messages | (opens or closes its panel) | — |
| main | button | Copy 0x6105e6c44a75ab833ab0cfdc2bff85bddd7ede98468326e288fb1 | (copies to clipboard) | — |
| main | button | Copy 0x99f4583f5e55ee403b1cc8655ebf7852198abbef7b5b2e5e16601 | (copies to clipboard) | — |
| main | button | Copy 0x7c09ba6c17c2c3f1db01dfb29996dfdec5faf5119a87fdb2f0c73 | (copies to clipboard) | — |
| main | button | Copy 0x26383a7981ac99506963aac4163eb426e686856b1d2ec27b0c3bc | (copies to clipboard) | — |
| main | summary | Pings <n> messages | (opens or closes its panel) | — |
| main | button | Copy 0x861ec57df5a28ece83577bbbb164149f6dcaa8aa0d65d2d5497dc | (copies to clipboard) | — |
| main | button | Copy 0x9f05eebccdaf031081b18953b8378778f31ac86bebc40b9bf98ef | (copies to clipboard) | — |
| main | button | Copy 0x43fcaa4bdbe284836e0e234127765b8b575ac5ee46abc1183f91c | (copies to clipboard) | — |
| main | summary | Announcements <n> messages | (opens or closes its panel) | — |
| main | button | Copy 0xbdbf718ecb81e5667e17d9a21c657266a7060e246c5c964e92dfd | (copies to clipboard) | — |
| main | button | Copy 0x2a60a6e74f7341f5b5ef8d8e5ce7aed8810856ea0f022f37f69be | (copies to clipboard) | — |
| main | button | Copy 0xb15daa516a4b2bab5e1d4ad5b36592318ed01406aca9dfd60ffc0 | (copies to clipboard) | — |
| main | button | Copy 0x7376b2ab343e00e3a135eac366b95a870f8f74f1e7c69c52b4003 | (copies to clipboard) | — |
| main | a | oversight-sample.json | https://scalarnet.io/oversight-sample.json (download) | 200 |

**docs-home — https://scalarnet.io/docs/**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | a | Read the guide | https://scalarnet.io/docs/guide/run-a-node | 200 |
| main | a | Read the guide | https://scalarnet.io/docs/guide/run-an-agent | 200 |
| main | a | Read the guide | https://scalarnet.io/docs/guide/run-a-validator | 200 |
| main | a | RPC reference | https://scalarnet.io/docs/reference/rpc | 200 |
| main | a | Token model | https://scalarnet.io/docs/reference/token-model | 200 |
| main | a | Constitution | https://scalarnet.io/docs/reference/constitution | 200 |
| main | a | Messages pallet | https://scalarnet.io/docs/reference/messages | 200 |
| main | a | Message envelope | https://scalarnet.io/docs/reference/messaging | 200 |
| main | a | Message privacy: what an operator can read | https://scalarnet.io/oversight | 200 |

**docs-article — https://scalarnet.io/docs/guide/run-an-agent**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | button | Pages | (opens the page list) | — |
| main | button | On this page | (opens the outline) | — |
| nav | a | Run a node | https://scalarnet.io/docs/guide/run-a-node | 200 |
| nav | a | Run an agent | https://scalarnet.io/docs/guide/run-an-agent | 200 |
| nav | a | Agent on the public testnet | https://scalarnet.io/docs/guide/run-an-agent-public-testnet | 200 |
| nav | a | Run a validator | https://scalarnet.io/docs/guide/run-a-validator | 200 |
| nav | a | Testnet tester guide | https://scalarnet.io/docs/guide/testnet-tester-guide | 200 |
| nav | a | SDK usage | https://scalarnet.io/docs/guide/sdk | 200 |
| nav | a | Messaging with the SDK | https://scalarnet.io/docs/guide/messaging-sdk | 200 |
| nav | a | RPC reference | https://scalarnet.io/docs/reference/rpc | 200 |
| nav | a | Token model | https://scalarnet.io/docs/reference/token-model | 200 |
| nav | a | Constitution | https://scalarnet.io/docs/reference/constitution | 200 |
| nav | a | Messages pallet | https://scalarnet.io/docs/reference/messages | 200 |
| nav | a | Message envelope | https://scalarnet.io/docs/reference/messaging | 200 |
| nav | a | Message privacy: what an operator can read | https://scalarnet.io/oversight | 200 |
| nav | a | What it does | https://scalarnet.io/docs/guide/run-an-agent#what-it-does | 200 |
| nav | a | Before you start | https://scalarnet.io/docs/guide/run-an-agent#before-you-start | 200 |
| nav | a | Option A: Docker | https://scalarnet.io/docs/guide/run-an-agent#option-a-docker | 200 |
| nav | a | Option B: run it natively | https://scalarnet.io/docs/guide/run-an-agent#option-b-run-it-natively | 200 |
| nav | a | Configuration | https://scalarnet.io/docs/guide/run-an-agent#configuration | 200 |
| nav | a | Check that it worked | https://scalarnet.io/docs/guide/run-an-agent#check-that-it-worked | 200 |
| nav | a | Buyer mode | https://scalarnet.io/docs/guide/run-an-agent#buyer-mode | 200 |
| nav | a | Publishing the image (maintainers) | https://scalarnet.io/docs/guide/run-an-agent#publishing-the-image-maintainers | 200 |
| main | a | Permalink to "Run an agent" | https://scalarnet.io/docs/guide/run-an-agent#run-an-agent | 200 |
| main | a | agent/ | https://github.com/tejaspatil1936/scalar-commons-v4/tree/master/agent | 200 |
| main | a | Option B | https://scalarnet.io/docs/guide/run-an-agent#option-b-run-it-natively | 200 |
| main | a | Run an agent on the public testnet | https://scalarnet.io/docs/guide/run-an-agent-public-testnet | 200 |
| main | a | #<n> | https://github.com/tejaspatil1936/scalar-commons-v4/issues/214 | 200 |
| main | a | Permalink to "What it does" | https://scalarnet.io/docs/guide/run-an-agent#what-it-does | 200 |
| main | a | issue #<n> | https://github.com/tejaspatil1936/scalar-commons-v4/issues/277 | 200 |
| main | a | issue #<n> | https://github.com/tejaspatil1936/scalar-commons-v4/issues/180 | 200 |
| main | a | How CMN is actually earned | https://scalarnet.io/docs/guide/testnet-tester-guide#_5-how-cmn-is-actually-earned | 200 |
| main | a | Permalink to "Before you start" | https://scalarnet.io/docs/guide/run-an-agent#before-you-start | 200 |
| main | a | Permalink to "Option A: Docker" | https://scalarnet.io/docs/guide/run-an-agent#option-a-docker | 200 |
| main | button | Copy Code | (copies the code) | — |
| main | a | Permalink to "Option B: run it natively" | https://scalarnet.io/docs/guide/run-an-agent#option-b-run-it-natively | 200 |
| main | a | Permalink to "Configuration" | https://scalarnet.io/docs/guide/run-an-agent#configuration | 200 |
| main | a | Permalink to "Check that it worked" | https://scalarnet.io/docs/guide/run-an-agent#check-that-it-worked | 200 |
| main | a | Permalink to "Buyer mode" | https://scalarnet.io/docs/guide/run-an-agent#buyer-mode | 200 |
| main | a | Permalink to "Publishing the image (maintainers)" | https://scalarnet.io/docs/guide/run-an-agent#publishing-the-image-maintainers | 200 |
| main | a | docs/ci-drafts/agent-image.yml | https://github.com/tejaspatil1936/scalar-commons-v4/blob/master/docs/ci-drafts/agent-image.yml | 200 |
| footer | a | Previous Run a node | https://scalarnet.io/docs/guide/run-a-node | 200 |
| footer | a | Next Agent on the public testnet | https://scalarnet.io/docs/guide/run-an-agent-public-testnet | 200 |

**docs-404 — https://scalarnet.io/docs/no-such-page**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | a | Home | https://scalarnet.io/ | 200 |
| main | a | Docs | https://scalarnet.io/docs/ | 200 |
| main | button | Search the docs | (opens the docs search) | — |

**explorer-home — https://explorer.scalarnet.io/**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | button | Search | (submits form → /search) | — |
| main | a | <n> (×11) | https://explorer.scalarnet.io/block/<n> | 200 |
| main | a | View all | https://explorer.scalarnet.io/blocks | 200 |
| main | a | <address> (×11) | https://explorer.scalarnet.io/account/<address> | 200 |
| main | button | Copy <address> (×11) | (copies to clipboard) | — |
| main | a | View all | https://explorer.scalarnet.io/activity | 200 |
| main | a | Heartbeat sent (×10) | https://explorer.scalarnet.io/extrinsic/<n>/<i> | 200 |
| main | button | Copy 0xff6882b49ad61dd3128a6e834b4f81704a3824ce358f2f69fe765 | (copies to clipboard) | — |

**explorer-blocks — https://explorer.scalarnet.io/blocks**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| nav | a | Explorer | https://explorer.scalarnet.io/ | 200 |
| main | a | <n> (×25) | https://explorer.scalarnet.io/block/<n> | 200 |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x67cb8d6f4bbf7150afb72566e27b9fac479ed8a2537cf951a7c2ad20d297a34a | 200 |
| main | button | Copy 0x67cb8d6f4bbf7150afb72566e27b9fac479ed8a2537cf951a7c2a | (copies to clipboard) | — |
| main | a | <address> (×8) | https://explorer.scalarnet.io/account/<address> | 200 |
| main | button | Copy <address> (×8) | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>xd9a20160f52e02e7bb9f07ec078db2d551c7e39da3ea6eb9368e10aac860872c | 200 |
| main | button | Copy 0xd9a20160f52e02e7bb9f07ec078db2d551c7e39da3ea6eb9368e1 | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x4c0ddabae<address> | 200 |
| main | button | Copy 0x4c0ddabae<address> | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x4e4728dfe72224aac1aca3004548f58ff81823f73db01fb94fb359b78b755de9 | 200 |
| main | button | Copy 0x4e4728dfe72224aac1aca3004548f58ff81823f73db01fb94fb35 | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x11325fa7f9670753b99f98bfeb415dc49d965bb20fba46d4c4eec4f9fff0f45b | 200 |
| main | button | Copy 0x11325fa7f9670753b99f98bfeb415dc49d965bb20fba46d4c4eec | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x943ebd7035c29c6c4f166bdab9c1027da5e86584734a2d14bd83aa1de4dd03e7 | 200 |
| main | button | Copy 0x943ebd7035c29c6c4f166bdab9c1027da5e86584734a2d14bd83a | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x57c55370b2543c5d1a410<address> | 200 |
| main | button | Copy 0x57c55370b2543c5d1a4105a719192a42ab53f28dd1f8ffa38f62b | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>xf463a532549e6794c76afe7d4b3732acf7017d230efa5eff153aaa0908ebbcf1 | 200 |
| main | button | Copy 0xf463a532549e6794c76afe7d4b3732acf7017d230efa5eff153aa | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x4cda470ec78a79be1a8973968a849f095ff8c2dc84d280b7f86d46568ca4f597 | 200 |
| main | button | Copy 0x4cda470ec78a79be1a8973968a849f095ff8c2dc84d280b7f86d4 | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x0f26462cf7982d13dc0fcc60faa90658b9d1c42e84eff2891d500a36a8663f6f | 200 |
| main | button | Copy 0x0f26462cf7982d13dc0fcc60faa90658b9d1c42e84eff2891d500 | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x4b01ca9e1c566f74a943d20eb03c1ff6e64f46467ca193af0ff43c8e18dc5e42 | 200 |
| main | button | Copy 0x4b01ca9e1c566f74a943d20eb03c1ff6e64f46467ca193af0ff43 | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x6725ade1504ecbf57dd6ea1e707ad99fff92d09a0f75f0edb22cf72c0476d075 | 200 |
| main | button | Copy 0x6725ade1504ecbf57dd6ea1e707ad99fff92d09a0f75f0edb22cf | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x1520c53dea54993913a7f8c9cbfeb611e603d61741312a7f21605125fc4ab654 | 200 |
| main | button | Copy 0x1520c53dea54993913a7f8c9cbfeb611e603d61741312a7f21605 | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x1b823bf8e6bf8f81f4dc5a3bdeff286dbadda9b034f04cc15ee434f15fe4ddc3 | 200 |
| main | button | Copy 0x1b823bf8e6bf8f81f4dc5a3bdeff286dbadda9b034f04cc15ee43 | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x778d9499c1c5776e5a0bde80c2db02ff656acced64c756d6709b99a807b7c505 | 200 |
| main | button | Copy 0x778d9499c1c5776e5a0bde80c2db02ff656acced64c756d6709b9 | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x4e8765c8b22cac871234eacdca6a356b3b332800a27d15246d98f3f4e31810cd | 200 |
| main | button | Copy 0x4e8765c8b22cac871234eacdca6a356b3b332800a27d15246d98f | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>x052bfe3e2802ff61b304b00601f58926598476d77bef6418b3d75aa2c8d6eb53 | 200 |
| main | button | Copy 0x052bfe3e2802ff61b304b00601f58926598476d77bef6418b3d75 | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>xbf281ba6449a8c3862f7100868eac15cce934295c2a3d041c38433074359e938 | 200 |
| main | button | Copy 0xbf281ba6449a8c3862f7100868eac15cce934295c2a3d041c3843 | (copies to clipboard) | — |
| main | a | <hash> | https://explorer.scalarnet.io/block/<n>xea611b13f3a6ebc364f106ec85cf14746f4dbdf582d5f792eff405d39994ee90 | 200 |
| main | button | Copy 0xea611b13f3a6ebc364f106ec85cf14746f4dbdf582d5f792eff40 | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x225789f828ca7a2cc171e37caf7606fb01ef6729f7dab4af21ae4c4a41aef8fd | 200 |
| main | button | Copy 0x225789f828ca7a2cc171e37caf7606fb01ef6729f7dab4af21ae4 | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x389ee50ed43c83828fd8210eaa0a5d4190b541181298c2208a71ef5a6097132d | 200 |
| main | button | Copy 0x389ee50ed43c83828fd8210eaa0a5d4190b541181298c2208a71e | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x99724b03051ed54132d7e4e3a75b0e0c095432fc2377869295a1b1edb1b3dd81 | 200 |
| main | button | Copy 0x99724b03051ed54132d7e4e3a75b0e0c095432fc2377869295a1b | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x145886a7b452a0660740ec584701acfaeac6d9733ecb31642fe51d223711a343 | 200 |
| main | button | Copy 0x145886a7b452a0660740ec584701acfaeac6d9733ecb31642fe51 | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>x6df95603bc1cb<address> | 200 |
| main | button | Copy 0x6df95603bc1cb5b89efc71b2cc884e8c72f61446f18bb756d182a | (copies to clipboard) | — |
| main | a | <n><address> | https://explorer.scalarnet.io/block/<n>xf554a9afef0726f09864a4f1b69a37899cbed012cd083f3ded467e1ef980e9ce | 200 |
| main | button | Copy 0xf554a9afef0726f09864a4f1b69a37899cbed012cd083f3ded467 | (copies to clipboard) | — |
| nav | a | Next | https://explorer.scalarnet.io/blocks?page=<n> | 200 |

**explorer-block — https://explorer.scalarnet.io/block/1167604**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| nav | a | Explorer | https://explorer.scalarnet.io/ | 200 |
| main | button | Copy 0x1bb16cc0a1e056c78d0b0dd430bac11cd87a6fcc32a267198a48e | (copies to clipboard) | — |
| main | a | 0x89<address><n> | https://explorer.scalarnet.io/block/<n> | 200 |
| main | button | Copy 0x894a6af9b16013571e2de1182ac04a593f7b2117122469e7084bb | (copies to clipboard) | — |
| main | a | <address> | https://explorer.scalarnet.io/account/<address> | 200 |
| main | button | Copy <address> | (copies to clipboard) | — |
| main | button | Copy 0xf6994c7ff962818a16d191481f6b999f4a37f1ec2faa1c32a149e | (copies to clipboard) | — |
| main | a | Extrinsics | https://explorer.scalarnet.io/block/<n> | 200 |
| main | a | Events | https://explorer.scalarnet.io/block/<n>?tab=events | 200 |
| main | a | <n>-<n> | https://explorer.scalarnet.io/extrinsic/<n>/<i> | 200 |
| main | button | Copy 0xbec1f9b0d474c351cb7525d7ef72b5a7da63184ebbdd8df8e7d70 | (copies to clipboard) | — |
| main | a | Previous block | https://explorer.scalarnet.io/block/<n> | 200 |
| main | a | Next block | https://explorer.scalarnet.io/block/<n> | 200 |

**explorer-extrinsic — https://explorer.scalarnet.io/extrinsic/1167379/1**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| nav | a | Explorer | https://explorer.scalarnet.io/ | 200 |
| nav | a | Block <n> | https://explorer.scalarnet.io/block/<n> | 200 |
| main | a | <n> | https://explorer.scalarnet.io/block/<n> | 200 |
| main | button | Copy 0xb4d4d32a38d039b3be80f4c0b399be06de626d2dffd27025ab2d2 | (copies to clipboard) | — |
| main | a | <address> | https://explorer.scalarnet.io/account/<address> | 200 |
| main | button | Copy <address> | (copies to clipboard) | — |

**explorer-account — https://explorer.scalarnet.io/account/5EXafHTU8EqCiszgQh6TVx7sZE7v3VQmvCyNVmsmrDzP5r5Y**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| nav | a | Explorer | https://explorer.scalarnet.io/ | 200 |
| main | button | Copy <address> | (copies to clipboard) | — |
| main | a | Extrinsics | https://explorer.scalarnet.io/account/<address> | 200 |
| main | a | Activity | https://explorer.scalarnet.io/account/<address>?tab=activity | 200 |
| main | a | <n>-<n> | https://explorer.scalarnet.io/extrinsic/<n>/<i> | 200 |

**explorer-activity — https://explorer.scalarnet.io/activity**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| nav | a | Explorer | https://explorer.scalarnet.io/ | 200 |
| main | a | <n> (×26) | https://explorer.scalarnet.io/block/<n> | 200 |
| main | a | All | https://explorer.scalarnet.io/activity | 200 |
| main | a | Agreements | https://explorer.scalarnet.io/activity?kind=agreement | 200 |
| main | a | Disputes | https://explorer.scalarnet.io/activity?kind=dispute | 200 |
| main | a | Messages | https://explorer.scalarnet.io/activity?kind=message | 200 |
| main | a | Registrations | https://explorer.scalarnet.io/activity?kind=registration | 200 |
| main | a | Slashes | https://explorer.scalarnet.io/activity?kind=slash | 200 |
| main | button | Filter | (submits form → /activity) | — |
| main | a | Heartbeat sent (×25) | https://explorer.scalarnet.io/extrinsic/<n>/<i> | 200 |
| main | a | <address> (×4) | https://explorer.scalarnet.io/account/<address> | 200 |
| main | button | Copy <address> (×4) | (copies to clipboard) | — |
| nav | a | Next | https://explorer.scalarnet.io/activity?page=<n> | 200 |

**explorer-search — https://explorer.scalarnet.io/search?q=nothing-matches-this**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | button | Search | (submits form → /search) | — |

**explorer-404 — https://explorer.scalarnet.io/no-such-page**

| where | element | label | goes to | answers |
|---|---|---|---|---|
| main | button | Search | (submits form → /search) | — |

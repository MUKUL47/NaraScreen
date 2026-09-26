// Acme Tasks (mobile) — fixture for the NaraScreen flutter plugin.
// Deliberately does NOT enable semantics itself: the plugin must do it, as it
// would for any real app.
import 'package:flutter/material.dart';

// Test switches (query string):
//   ?stuck=1   — never leaves the splash screen, like an app awaiting a
//                native-only plugin (path_provider…) on web.
//   ?api=<url> — the home screen loads an avatar from that server, like an app
//                calling a backend baked into its build.
void main() {
  final q = Uri.base.queryParameters;
  if (q['stuck'] == '1') {
    // ignore: avoid_print
    print('ApiClient.init: waiting for getApplicationDocumentsDirectory() (never completes on web)');
    runApp(const StuckApp());
    return;
  }
  runApp(AcmeApp(api: q['api']));
}

class StuckApp extends StatelessWidget {
  const StuckApp({super.key});
  @override
  Widget build(BuildContext context) => const MaterialApp(
        debugShowCheckedModeBanner: false,
        home: Scaffold(body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.task_alt, size: 64), Text('Acme Tasks')]))),
      );
}

class AcmeApp extends StatelessWidget {
  const AcmeApp({super.key, this.api});
  final String? api;
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'Acme Tasks',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
        home: LoginPage(api: api),
      );
}

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, this.api});
  final String? api;
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final email = TextEditingController();
  final password = TextEditingController();
  String? error;

  void signIn() {
    if (email.text.contains('@') && password.text.isNotEmpty) {
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => HomePage(user: email.text, api: widget.api)));
    } else {
      setState(() => error = 'Enter your email and password');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Acme Tasks', style: Theme.of(context).textTheme.headlineMedium, textAlign: TextAlign.center),
              const SizedBox(height: 32),
              TextField(controller: email, decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder())),
              const SizedBox(height: 16),
              TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: 'Password', border: OutlineInputBorder())),
              if (error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error!, style: const TextStyle(color: Colors.red))),
              const SizedBox(height: 24),
              FilledButton(onPressed: signIn, child: const Text('Sign in')),
            ]),
          ),
        ),
      );
}

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.user, this.api});
  final String user;
  final String? api;
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int tab = 0;
  final tasks = List.generate(30, (i) => 'Task ${i + 1}');

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(tab == 0 ? 'Tasks' : 'Highlights'), actions: [
          if (widget.api != null) Padding(padding: const EdgeInsets.all(8), child: CircleAvatar(backgroundImage: NetworkImage('${widget.api}/avatar.png'))),
        ]),
        body: tab == 0 ? taskList() : highlights(),
        floatingActionButton: tab == 0
            ? FloatingActionButton(
                tooltip: 'New task',
                onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Task created'))),
                child: const Icon(Icons.add),
              )
            : null,
        bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) => setState(() => tab = i),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.checklist), label: 'Tasks'),
            NavigationDestination(icon: Icon(Icons.star), label: 'Highlights'),
          ],
        ),
      );

  Widget taskList() => ListView.builder(
        itemCount: tasks.length,
        itemBuilder: (_, i) => ListTile(
          title: Text(tasks[i]),
          subtitle: Text(i % 3 == 0 ? 'High priority' : 'Normal'),
          leading: CircleAvatar(child: Text('${i + 1}')),
          onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => DetailPage(title: tasks[i]))),
        ),
      );

  Widget highlights() => PageView(
        children: [
          for (final (i, c) in [Colors.indigo, Colors.teal, Colors.orange].indexed)
            Container(
              color: c.shade100,
              alignment: Alignment.center,
              child: Text('Highlight ${i + 1} of 3', style: Theme.of(context).textTheme.headlineSmall),
            ),
        ],
      );
}

class DetailPage extends StatelessWidget {
  const DetailPage({super.key, required this.title});
  final String title;
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Details for $title', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            const Text('Due Friday · assigned to you'),
            const SizedBox(height: 24),
            OutlinedButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Mark as done')),
          ]),
        ),
      );
}

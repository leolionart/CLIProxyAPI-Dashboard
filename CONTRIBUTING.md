# Contributing to CLIProxy Dashboard

First off, thank you for considering contributing to CLIProxy Dashboard! 🎉

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Project Structure](#project-structure)

---

## Code of Conduct

This project adheres to a simple code of conduct:

- Be respectful and inclusive
- Focus on constructive feedback
- Help maintain a welcoming environment

## How Can I Contribute?

### 🐛 Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

When creating a bug report, include:

- Clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Screenshots if applicable
- Environment details (OS, Docker version, etc.)

**Bug Report Template:**
```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen.

**Environment:**
- OS: [e.g., Ubuntu 22.04]
- Docker version: [e.g., 24.0.0]
- Browser: [e.g., Chrome 120]
```

### 💡 Suggesting Enhancements

Enhancement suggestions are welcome! Please include:

- Clear description of the enhancement
- Why this would be useful
- Possible implementation approach
- Any mockups or examples

### 🔧 Code Contributions

We love pull requests! Here's how:

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages
6. Push to your fork
7. Open a Pull Request

---

## Development Setup

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for frontend development)
- Python 3.10+ (for collector development)
- Supabase account

### Local Development

#### Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Access at `http://localhost:5173` with hot reload.

#### Collector (Python)

```bash
cd collector
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

### Testing Changes

#### Full Stack Test (Docker)

```bash
# Rebuild and restart all services
docker compose down
docker compose build
docker compose up -d

# Check logs
docker compose logs -f
```

---

## Pull Request Process

### Before Submitting

- [ ] Test your changes locally
- [ ] Update documentation if needed
- [ ] Add comments to complex code
- [ ] Ensure no sensitive data is committed
- [ ] Follow existing code style

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Refactoring

## Testing
How did you test these changes?

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Code follows project style
- [ ] Documentation updated
- [ ] No sensitive data committed
- [ ] Tested locally
```

### Review Process

1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, your PR will be merged
4. Your contribution will be credited!

---

## Coding Standards

### Python (Collector)

- Follow PEP 8 style guide
- Use type hints where appropriate
- Add docstrings to functions
- Keep functions focused and small

```python
def calculate_cost(input_tokens: int, output_tokens: int, pricing: dict) -> float:
    """
    Calculate estimated cost based on token usage and pricing.

    Args:
        input_tokens: Number of input tokens
        output_tokens: Number of output tokens
        pricing: Dict with 'input_price' and 'output_price' per 1M tokens

    Returns:
        Estimated cost in USD
    """
    input_cost = (input_tokens / 1_000_000) * pricing['input_price']
    output_cost = (output_tokens / 1_000_000) * pricing['output_price']
    return input_cost + output_cost
```

### JavaScript/React (Frontend)

- Use functional components with hooks
- Keep components small and focused
- Use meaningful variable names
- Add comments for complex logic

```javascript
// Good: Clear component with single responsibility
function StatCard({ title, value, icon }) {
  return (
    <div className="stat-card">
      {icon}
      <h3>{title}</h3>
      <p>{value}</p>
    </div>
  );
}
```

### General Guidelines

- **DRY (Don't Repeat Yourself)**: Extract reusable logic
- **Single Responsibility**: Each function/component does one thing
- **Clear Naming**: Use descriptive names for variables and functions
- **Error Handling**: Always handle potential errors
- **Comments**: Explain *why*, not *what* (code shows what)

---

## Project Structure

```
cliproxy-dashboard/
├── collector/              # Python data collector
│   ├── main.py            # Main collector logic
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/              # React dashboard
│   ├── src/
│   │   ├── App.jsx       # Main app component
│   │   ├── components/   # Reusable components
│   │   │   └── Dashboard.jsx
│   │   └── lib/
│   │       └── supabase.js
│   ├── Dockerfile
│   └── package.json
│
├── docker-compose.yml     # Service orchestration
├── supabase-schema.sql    # Database schema
├── .env.example           # Environment template
├── README.md              # Main documentation
├── SETUP.md               # Setup guide
├── CLAUDE.md              # AI assistant context
└── CONTRIBUTING.md        # This file
```

### Key Areas for Contribution

#### 🎨 Frontend
- UI/UX improvements
- New chart types
- Performance optimizations
- Responsive design enhancements

#### 🔧 Collector
- New data aggregation features
- Rate limit enhancements
- Performance optimizations
- Additional API endpoints

#### 📚 Documentation
- Improve setup guides
- Add tutorials
- Fix typos
- Translate documentation

#### 🧪 Testing
- Add test coverage
- Write integration tests
- Improve error scenarios

---

## Environment Variables

Never commit these files:
- `.env` (contains secrets)
- Any files with API keys or passwords
- Database credentials

Always use `.env.example` as template with placeholder values.

---

## Questions?

- Open an issue for discussion
- Check existing issues and PRs
- See [README.md](README.md) for project overview
- See [SETUP.md](SETUP.md) for setup instructions

---

## Recognition

Contributors will be recognized in:
- GitHub contributors list
- Release notes
- Special thanks in README (for significant contributions)

Thank you for contributing! 🙌

import setuptools

# Read dependencies from requirements.txt
with open("requirements.txt") as f:
    requirements = f.read().splitlines()

setuptools.setup(
    name="agent-lens",
    version="0.1",
    packages=["agent_lens"],
    install_requires=requirements,
)
